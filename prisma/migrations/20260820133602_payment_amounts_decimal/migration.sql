-- Invoice.amount and PaymentLinkRequest.amount were Int (whole rupees),
-- silently truncating fractional-rupee collections/receipts (e.g. 3.50 -> 3).
-- Casting Integer -> Decimal(10,2) is lossless for existing whole-rupee rows.
ALTER TABLE "Invoice" ALTER COLUMN "amount" TYPE DECIMAL(10,2) USING "amount"::DECIMAL(10,2);
ALTER TABLE "PaymentLinkRequest" ALTER COLUMN "amount" TYPE DECIMAL(10,2) USING "amount"::DECIMAL(10,2);
