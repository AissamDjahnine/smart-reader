-- Create enums
CREATE TYPE "UserBookStatus" AS ENUM ('TO_READ', 'IN_PROGRESS', 'FINISHED');
CREATE TYPE "ShareStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- Create tables
CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "displayName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InviteCode" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "maxUses" INTEGER,
  "usedCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InviteCode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Book" (
  "id" TEXT NOT NULL,
  "epubHash" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "author" TEXT,
  "language" TEXT,
  "cover" TEXT,
  "filePath" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Book_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserBook" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "bookId" TEXT NOT NULL,
  "status" "UserBookStatus" NOT NULL DEFAULT 'TO_READ',
  "progressPercent" INTEGER NOT NULL DEFAULT 0,
  "progressCfi" TEXT,
  "lastOpenedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserBook_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Note" (
  "id" TEXT NOT NULL,
  "bookId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "cfi" TEXT,
  "text" TEXT NOT NULL,
  "message" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Highlight" (
  "id" TEXT NOT NULL,
  "bookId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "cfiRange" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "note" TEXT,
  "color" TEXT,
  "contextPrefix" TEXT,
  "contextSuffix" TEXT,
  "chapterHref" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Highlight_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BookShare" (
  "id" TEXT NOT NULL,
  "bookId" TEXT NOT NULL,
  "fromUserId" TEXT NOT NULL,
  "toUserId" TEXT NOT NULL,
  "message" TEXT,
  "status" "ShareStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acceptedAt" TIMESTAMP(3),
  CONSTRAINT "BookShare_pkey" PRIMARY KEY ("id")
);

-- Indexes/uniques
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "InviteCode_code_key" ON "InviteCode"("code");
CREATE UNIQUE INDEX "Book_epubHash_key" ON "Book"("epubHash");
CREATE UNIQUE INDEX "UserBook_userId_bookId_key" ON "UserBook"("userId", "bookId");
CREATE INDEX "UserBook_bookId_idx" ON "UserBook"("bookId");
CREATE INDEX "Note_bookId_idx" ON "Note"("bookId");
CREATE UNIQUE INDEX "Highlight_bookId_cfiRange_createdByUserId_key" ON "Highlight"("bookId", "cfiRange", "createdByUserId");
CREATE INDEX "Highlight_bookId_idx" ON "Highlight"("bookId");
CREATE INDEX "BookShare_toUserId_status_idx" ON "BookShare"("toUserId", "status");
CREATE UNIQUE INDEX "BookShare_bookId_fromUserId_toUserId_key" ON "BookShare"("bookId", "fromUserId", "toUserId");

-- FKs
ALTER TABLE "UserBook" ADD CONSTRAINT "UserBook_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserBook" ADD CONSTRAINT "UserBook_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Note" ADD CONSTRAINT "Note_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Note" ADD CONSTRAINT "Note_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Highlight" ADD CONSTRAINT "Highlight_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Highlight" ADD CONSTRAINT "Highlight_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BookShare" ADD CONSTRAINT "BookShare_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BookShare" ADD CONSTRAINT "BookShare_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BookShare" ADD CONSTRAINT "BookShare_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
