-- CreateEnum
CREATE TYPE "AnnotationScope" AS ENUM ('OWNER', 'LENDER_VISIBLE', 'PRIVATE_BORROWER');

-- AlterTable
ALTER TABLE "BookLoan"
ADD COLUMN "shareLenderAnnotations" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Highlight"
ADD COLUMN "scope" "AnnotationScope" NOT NULL DEFAULT 'OWNER';

-- AlterTable
ALTER TABLE "Note"
ADD COLUMN "scope" "AnnotationScope" NOT NULL DEFAULT 'OWNER';
