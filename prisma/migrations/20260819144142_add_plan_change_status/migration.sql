-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "planChangeRefundAmount" INTEGER,
ADD COLUMN     "planChangeRefundStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED';
