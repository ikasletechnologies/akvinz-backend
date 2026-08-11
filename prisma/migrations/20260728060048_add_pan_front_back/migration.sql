-- Preserve existing PAN links as the "front" side instead of dropping the column
ALTER TABLE "Customer" RENAME COLUMN "panImageUrl" TO "panFrontImageUrl";

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "panBackImageUrl" TEXT;
