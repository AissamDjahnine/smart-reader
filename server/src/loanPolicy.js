export const LOAN_EXPORT_WINDOW_DAYS = 14;

const toIsoJson = (value = null) => {
  if (!value) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
};

const getEffectiveLoanEndMs = (loan) => {
  if (!loan?.dueAt) return null;
  const dueMs = new Date(loan.dueAt).getTime();
  if (!Number.isFinite(dueMs)) return null;
  const graceDays = Math.max(0, Number(loan.graceDays) || 0);
  return dueMs + graceDays * 24 * 60 * 60 * 1000;
};

export const shouldExpireLoan = (loan) => {
  if (!loan || loan.status !== 'ACTIVE') return false;
  const effectiveEndMs = getEffectiveLoanEndMs(loan);
  return Number.isFinite(effectiveEndMs) && Date.now() > effectiveEndMs;
};

export const resolveLoanAnnotationScope = (loan) => {
  if (!loan) return 'OWNER';
  return loan.annotationVisibility === 'SHARED_WITH_LENDER'
    ? 'LENDER_VISIBLE'
    : 'PRIVATE_BORROWER';
};

export const getActiveBorrowLoan = async (db, userId, bookId, include = undefined) => {
  if (!userId || !bookId) return null;
  return db.bookLoan.findFirst({
    where: {
      bookId,
      borrowerId: userId,
      status: 'ACTIVE'
    },
    include,
    orderBy: { acceptedAt: 'desc' }
  });
};

const getActiveBorrowerIdsForLender = async (db, lenderId, bookId) => {
  if (!lenderId || !bookId) return [];
  const loans = await db.bookLoan.findMany({
    where: {
      bookId,
      lenderId,
      status: 'ACTIVE'
    },
    select: { borrowerId: true }
  });
  return loans.map((loan) => loan.borrowerId).filter(Boolean);
};

export const expireLoanIfNeeded = async (db, loan, options = {}) => {
  const {
    include = undefined,
    cleanupBorrowerAccess = true,
    addAuditEvent = true
  } = options;

  if (!shouldExpireLoan(loan)) return loan;
  const now = new Date();
  const exportAvailableUntil = new Date(now.getTime() + LOAN_EXPORT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const next = await db.bookLoan.update({
    where: { id: loan.id },
    data: {
      status: 'EXPIRED',
      expiredAt: now,
      exportAvailableUntil
    },
    include
  });

  if (cleanupBorrowerAccess && loan.createdUserBookOnAccept) {
    await db.userBook.deleteMany({
      where: {
        userId: loan.borrowerId,
        bookId: loan.bookId
      }
    });
  }

  if (addAuditEvent) {
    await db.loanAuditEvent.create({
      data: {
        loanId: loan.id,
        actorUserId: null,
        targetUserId: loan.borrowerId,
        action: 'LOAN_EXPIRED',
        detailsJson: toIsoJson({
          dueAt: loan.dueAt,
          graceDays: loan.graceDays
        })
      }
    });
  }

  return next;
};

export const ensureBookEntitlement = async (db, { userId, bookId }) => {
  if (!userId || !bookId) return { userBook: null, activeBorrowLoan: null };

  const activeBorrowLoan = await getActiveBorrowLoan(db, userId, bookId);
  if (activeBorrowLoan) {
    await expireLoanIfNeeded(db, activeBorrowLoan);
  }

  const userBook = await db.userBook.findUnique({
    where: {
      userId_bookId: {
        userId,
        bookId
      }
    }
  });

  const refreshedBorrowLoan = await getActiveBorrowLoan(db, userId, bookId);
  return { userBook, activeBorrowLoan: refreshedBorrowLoan };
};

export const buildAnnotationAccessWhere = async (db, { bookId, userId }) => {
  const activeBorrowLoan = await getActiveBorrowLoan(db, userId, bookId);
  if (activeBorrowLoan) {
    if (!activeBorrowLoan.shareLenderAnnotations) {
      return { bookId, createdByUserId: userId };
    }
    return {
      bookId,
      OR: [
        { createdByUserId: userId },
        { createdByUserId: activeBorrowLoan.lenderId, scope: 'OWNER' }
      ]
    };
  }

  const activeBorrowerIds = await getActiveBorrowerIdsForLender(db, userId, bookId);
  const where = {
    bookId,
    scope: { not: 'PRIVATE_BORROWER' }
  };
  if (!activeBorrowerIds.length) return where;
  return {
    ...where,
    NOT: [
      {
        AND: [
          { createdByUserId: { in: activeBorrowerIds } },
          { scope: 'LENDER_VISIBLE' }
        ]
      }
    ]
  };
};

export const requireBorrowCapability = async (db, { userId, bookId, capability }) => {
  const activeBorrowLoan = await getActiveBorrowLoan(db, userId, bookId);
  if (!activeBorrowLoan) {
    return { ok: true, activeBorrowLoan: null };
  }

  const map = {
    addHighlights: ['canAddHighlights', 'Lender disabled adding highlights for this loan'],
    editHighlights: ['canEditHighlights', 'Lender disabled editing highlights for this loan'],
    addNotes: ['canAddNotes', 'Lender disabled adding notes for this loan'],
    editNotes: ['canEditNotes', 'Lender disabled editing notes for this loan']
  };
  const [field, message] = map[capability] || [];
  if (!field) {
    return { ok: false, status: 500, error: 'Unknown borrow capability' };
  }
  if (!activeBorrowLoan[field]) {
    return { ok: false, status: 403, error: message };
  }

  return { ok: true, activeBorrowLoan };
};
