-- AlterTable
ALTER TABLE "PaymentLinkRequest" ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "razorpayPaymentId" TEXT,
ADD COLUMN     "razorpayPaymentLinkId" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'CREATED';

-- CreateIndex
CREATE UNIQUE INDEX "PaymentLinkRequest_razorpayPaymentLinkId_key" ON "PaymentLinkRequest"("razorpayPaymentLinkId");
