import path from 'path';
import { verifyToken } from './auth.js';
import { prisma } from './prisma.js';

const resolveToken = (req) => {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const queryToken = req.query?.token;
  if (typeof queryToken === 'string' && queryToken.trim()) return queryToken.trim();
  return '';
};

export const requireAuth = (req, res, next) => {
  try {
    const token = resolveToken(req);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const payload = verifyToken(token);
    req.auth = { userId: payload.sub, email: payload.email, token };
    return next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
};

export const requireBookAccess = async (req, res, next) => {
  const { bookId } = req.params;
  if (!bookId) return res.status(400).json({ error: 'bookId required' });

  const activeBorrowLoan = await prisma.bookLoan.findFirst({
    where: {
      bookId,
      borrowerId: req.auth.userId,
      status: 'ACTIVE'
    },
    orderBy: { acceptedAt: 'desc' }
  });

  if (activeBorrowLoan?.dueAt) {
    const dueMs = new Date(activeBorrowLoan.dueAt).getTime();
    const graceDays = Math.max(0, Number(activeBorrowLoan.graceDays) || 0);
    const effectiveEndMs = dueMs + graceDays * 24 * 60 * 60 * 1000;
    if (Number.isFinite(effectiveEndMs) && Date.now() > effectiveEndMs) {
      await prisma.$transaction(async (tx) => {
        await tx.bookLoan.update({
          where: { id: activeBorrowLoan.id },
          data: {
            status: 'EXPIRED',
            expiredAt: new Date(),
            exportAvailableUntil: null
          }
        });
        if (activeBorrowLoan.createdUserBookOnAccept) {
          await tx.userBook.deleteMany({
            where: {
              userId: req.auth.userId,
              bookId
            }
          });
        }
      });
    }
  }

  const userBook = await prisma.userBook.findUnique({
    where: {
      userId_bookId: {
        userId: req.auth.userId,
        bookId
      }
    }
  });

  if (!userBook) return res.status(403).json({ error: 'No access to this book' });
  req.userBook = userBook;
  return next();
};

export const isSafeRelativePath = (value) => {
  if (typeof value !== 'string' || !value.trim()) return false;
  if (path.isAbsolute(value)) return false;
  const normalized = path.normalize(value).replace(/\\/g, '/');
  return !normalized.startsWith('../') && !normalized.includes('/../');
};
