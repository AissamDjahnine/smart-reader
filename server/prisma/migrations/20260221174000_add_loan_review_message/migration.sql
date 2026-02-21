-- CreateTable
CREATE TABLE IF NOT EXISTS "LoanReviewMessage" (
  "id" TEXT NOT NULL,
  "loanId" TEXT NOT NULL,
  "authorUserId" TEXT NOT NULL,
  "rating" INTEGER NOT NULL,
  "comment" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LoanReviewMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LoanReviewMessage_loanId_createdAt_idx" ON "LoanReviewMessage"("loanId", "createdAt");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'LoanReviewMessage_loanId_fkey'
  ) THEN
    ALTER TABLE "LoanReviewMessage"
      ADD CONSTRAINT "LoanReviewMessage_loanId_fkey"
      FOREIGN KEY ("loanId") REFERENCES "BookLoan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'LoanReviewMessage_authorUserId_fkey'
  ) THEN
    ALTER TABLE "LoanReviewMessage"
      ADD CONSTRAINT "LoanReviewMessage_authorUserId_fkey"
      FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
