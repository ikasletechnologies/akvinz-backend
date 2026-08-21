-- RENTAL invoices need to record the rental period they cover
-- (rentStartDate/rentEndDate), distinct from documentDate/paymentDate (when
-- the payment actually happened) -- a late payment covers a period starting
-- from the payment date, not the originally scheduled due date.
ALTER TABLE "Invoice" ADD COLUMN "rentStartDate" TIMESTAMP(3);
ALTER TABLE "Invoice" ADD COLUMN "rentEndDate" TIMESTAMP(3);
