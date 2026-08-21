-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "razorpayXContactId" TEXT,
ADD COLUMN     "razorpayXFundAccountId" TEXT;

-- CreateTable
CREATE TABLE "MoneyTransaction" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "reason" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "razorpayPayoutId" TEXT,
    "razorpayPayoutStatus" TEXT,
    "razorpayStatusReason" TEXT,
    "razorpayStatusDescription" TEXT,
    "razorpayUtr" TEXT,
    "recipientFundAccountId" TEXT,
    "recipientNameSnapshot" TEXT,
    "recipientIdentifierSnapshot" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "otpChallengeId" TEXT,
    "otpExpiresAt" TIMESTAMP(3),
    "otpAttempts" INTEGER NOT NULL DEFAULT 0,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "proofUrl" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MoneyTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RazorpayWebhookEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payoutId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RazorpayWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MoneyTransaction_razorpayPayoutId_key" ON "MoneyTransaction"("razorpayPayoutId");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyTransaction_idempotencyKey_key" ON "MoneyTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "MoneyTransaction_customerId_createdAt_idx" ON "MoneyTransaction"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "MoneyTransaction_status_idx" ON "MoneyTransaction"("status");

-- CreateIndex
CREATE INDEX "MoneyTransaction_razorpayPayoutId_idx" ON "MoneyTransaction"("razorpayPayoutId");

-- CreateIndex
CREATE UNIQUE INDEX "RazorpayWebhookEvent_eventId_key" ON "RazorpayWebhookEvent"("eventId");

-- AddForeignKey
ALTER TABLE "MoneyTransaction" ADD CONSTRAINT "MoneyTransaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
