-- Manual-payment proof photos need to appear on the receipt PDF itself, not
-- just as a link in the admin dashboard's payout history.
ALTER TABLE "Invoice" ADD COLUMN "proofUrl" TEXT;
