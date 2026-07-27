-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "returnRequested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "returnRequestedAt" TIMESTAMP(3);
