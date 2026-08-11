-- Preserve existing Aadhaar links as the "front" side instead of dropping the column
ALTER TABLE "Customer" RENAME COLUMN "aadharImageUrl" TO "aadharFrontImageUrl";

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "aadharBackImageUrl" TEXT;
