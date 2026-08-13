-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "autopayStatus" TEXT DEFAULT 'NOT_SET',
ADD COLUMN     "razorpayPlanId" TEXT,
ADD COLUMN     "razorpaySubscriptionId" TEXT;
