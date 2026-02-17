-- CreateEnum
CREATE TYPE "LoanRenewalStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');

-- AlterTable
ALTER TABLE "BookLoan"
ADD COLUMN "dueSoonNotifiedAt" TIMESTAMP(3),
ADD COLUMN "overdueNotifiedAt" TIMESTAMP(3),
ADD COLUMN "endedReminderNotifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Highlight"
ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Note"
ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "LoanRenewalRequest" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "requesterUserId" TEXT NOT NULL,
    "reviewerUserId" TEXT,
    "lenderId" TEXT NOT NULL,
    "borrowerId" TEXT NOT NULL,
    "status" "LoanRenewalStatus" NOT NULL DEFAULT 'PENDING',
    "requestedExtraDays" INTEGER NOT NULL,
    "previousDueAt" TIMESTAMP(3) NOT NULL,
    "proposedDueAt" TIMESTAMP(3) NOT NULL,
    "decisionMessage" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoanRenewalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserLoanTemplate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Default lending template',
    "durationDays" INTEGER NOT NULL DEFAULT 14,
    "graceDays" INTEGER NOT NULL DEFAULT 0,
    "canAddHighlights" BOOLEAN NOT NULL DEFAULT true,
    "canEditHighlights" BOOLEAN NOT NULL DEFAULT true,
    "canAddNotes" BOOLEAN NOT NULL DEFAULT true,
    "canEditNotes" BOOLEAN NOT NULL DEFAULT true,
    "annotationVisibility" "AnnotationVisibility" NOT NULL DEFAULT 'PRIVATE',
    "shareLenderAnnotations" BOOLEAN NOT NULL DEFAULT false,
    "remindBeforeDays" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserLoanTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "loanId" TEXT,
    "eventKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "payloadJson" TEXT,
    "actionType" TEXT,
    "actionTargetId" TEXT,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoanRenewalRequest_loanId_status_idx" ON "LoanRenewalRequest"("loanId", "status");

-- CreateIndex
CREATE INDEX "LoanRenewalRequest_borrowerId_status_idx" ON "LoanRenewalRequest"("borrowerId", "status");

-- CreateIndex
CREATE INDEX "LoanRenewalRequest_lenderId_status_idx" ON "LoanRenewalRequest"("lenderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "UserLoanTemplate_userId_key" ON "UserLoanTemplate"("userId");

-- CreateIndex
CREATE INDEX "UserNotification_userId_createdAt_idx" ON "UserNotification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "UserNotification_loanId_idx" ON "UserNotification"("loanId");

-- CreateIndex
CREATE UNIQUE INDEX "UserNotification_userId_eventKey_key" ON "UserNotification"("userId", "eventKey");

-- AddForeignKey
ALTER TABLE "LoanRenewalRequest" ADD CONSTRAINT "LoanRenewalRequest_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "BookLoan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanRenewalRequest" ADD CONSTRAINT "LoanRenewalRequest_requesterUserId_fkey" FOREIGN KEY ("requesterUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanRenewalRequest" ADD CONSTRAINT "LoanRenewalRequest_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanRenewalRequest" ADD CONSTRAINT "LoanRenewalRequest_lenderId_fkey" FOREIGN KEY ("lenderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanRenewalRequest" ADD CONSTRAINT "LoanRenewalRequest_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserLoanTemplate" ADD CONSTRAINT "UserLoanTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNotification" ADD CONSTRAINT "UserNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNotification" ADD CONSTRAINT "UserNotification_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "BookLoan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
