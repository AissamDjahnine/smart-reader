-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('PENDING', 'ACTIVE', 'RETURNED', 'EXPIRED', 'REVOKED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AnnotationVisibility" AS ENUM ('PRIVATE', 'SHARED_WITH_LENDER');

-- CreateTable
CREATE TABLE "BookLoan" (
  "id" TEXT NOT NULL,
  "bookId" TEXT NOT NULL,
  "lenderId" TEXT NOT NULL,
  "borrowerId" TEXT NOT NULL,
  "status" "LoanStatus" NOT NULL DEFAULT 'PENDING',
  "message" TEXT,
  "durationDays" INTEGER NOT NULL DEFAULT 14,
  "graceDays" INTEGER NOT NULL DEFAULT 0,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acceptedAt" TIMESTAMP(3),
  "dueAt" TIMESTAMP(3),
  "returnedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "expiredAt" TIMESTAMP(3),
  "exportAvailableUntil" TIMESTAMP(3),
  "createdUserBookOnAccept" BOOLEAN NOT NULL DEFAULT false,
  "canAddHighlights" BOOLEAN NOT NULL DEFAULT true,
  "canEditHighlights" BOOLEAN NOT NULL DEFAULT true,
  "canAddNotes" BOOLEAN NOT NULL DEFAULT true,
  "canEditNotes" BOOLEAN NOT NULL DEFAULT true,
  "annotationVisibility" "AnnotationVisibility" NOT NULL DEFAULT 'PRIVATE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BookLoan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanAuditEvent" (
  "id" TEXT NOT NULL,
  "loanId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "targetUserId" TEXT,
  "action" TEXT NOT NULL,
  "detailsJson" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LoanAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookLoan_borrowerId_status_idx" ON "BookLoan"("borrowerId", "status");

-- CreateIndex
CREATE INDEX "BookLoan_lenderId_status_idx" ON "BookLoan"("lenderId", "status");

-- CreateIndex
CREATE INDEX "BookLoan_bookId_status_idx" ON "BookLoan"("bookId", "status");

-- CreateIndex
CREATE INDEX "LoanAuditEvent_loanId_createdAt_idx" ON "LoanAuditEvent"("loanId", "createdAt");

-- AddForeignKey
ALTER TABLE "BookLoan" ADD CONSTRAINT "BookLoan_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookLoan" ADD CONSTRAINT "BookLoan_lenderId_fkey" FOREIGN KEY ("lenderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookLoan" ADD CONSTRAINT "BookLoan_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanAuditEvent" ADD CONSTRAINT "LoanAuditEvent_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "BookLoan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanAuditEvent" ADD CONSTRAINT "LoanAuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanAuditEvent" ADD CONSTRAINT "LoanAuditEvent_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
