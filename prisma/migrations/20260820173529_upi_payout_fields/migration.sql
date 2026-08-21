-- Lets an admin pay a customer via UPI ID instead of requiring saved bank
-- details, alongside the existing bank-account payout — no other tables
-- touched, so plan-change/refund flows are unaffected.
ALTER TABLE "MoneyTransaction" ADD COLUMN "payoutDestinationType" TEXT;
ALTER TABLE "MoneyTransaction" ADD COLUMN "payoutVpa" TEXT;
