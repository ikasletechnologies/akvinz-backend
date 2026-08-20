-- Captures the customer's UPI VPA when their security-deposit payment was
-- made via UPI, so the admin "Pay Customer > UPI ID" option can pre-fill it.
ALTER TABLE "Customer" ADD COLUMN "customerUpiVpa" TEXT;
