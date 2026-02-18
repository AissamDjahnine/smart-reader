-- CreateTable
CREATE TABLE "LoanDiscussionReadState" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoanDiscussionReadState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LoanDiscussionReadState_loanId_userId_key" ON "LoanDiscussionReadState"("loanId", "userId");

-- CreateIndex
CREATE INDEX "LoanDiscussionReadState_userId_updatedAt_idx" ON "LoanDiscussionReadState"("userId", "updatedAt");

-- AddForeignKey
ALTER TABLE "LoanDiscussionReadState" ADD CONSTRAINT "LoanDiscussionReadState_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "BookLoan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanDiscussionReadState" ADD CONSTRAINT "LoanDiscussionReadState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
