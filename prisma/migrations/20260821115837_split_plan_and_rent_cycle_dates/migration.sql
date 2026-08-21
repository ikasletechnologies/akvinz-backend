-- subscriptionStart/subscriptionEnd were overloaded with two conflicting
-- meanings: activateRentalCycle overwrote them on EVERY monthly payment to
-- track the current billing cycle, while the admin dashboard's "Plan Term"
-- display also read subscriptionStart to compute the whole 12/24-month
-- contract end -- which silently drifted forward every time a customer paid
-- rent. Splitting into a fixed plan-term pair and a per-cycle pair fixes
-- this at the schema level.

ALTER TABLE "Customer"
  ADD COLUMN "planStartDate" TIMESTAMP(3),
  ADD COLUMN "planEndDate" TIMESTAMP(3),
  ADD COLUMN "currentRentStartDate" TIMESTAMP(3),
  ADD COLUMN "currentRentEndDate" TIMESTAMP(3),
  ADD COLUMN "nextRentDueDate" TIMESTAMP(3);

-- Current cycle: carries over directly from the old fields' most recent
-- (i.e. current) values. lastPaymentDate covers the historical gap where an
-- old webhook path set subscriptionEnd but never subscriptionStart.
UPDATE "Customer"
SET
  "currentRentStartDate" = COALESCE("subscriptionStart", "lastPaymentDate"),
  "nextRentDueDate" = "subscriptionEnd",
  "currentRentEndDate" = "subscriptionEnd" - INTERVAL '1 day'
WHERE "subscriptionStart" IS NOT NULL OR "subscriptionEnd" IS NOT NULL;

-- Plan start: the customer's FIRST ever rental payment, from invoice
-- history where available (uncorrupted by the monthly-overwrite bug above) --
-- falls back to the current (possibly-drifted) subscriptionStart only when
-- no RENTAL invoice exists.
UPDATE "Customer" c
SET "planStartDate" = COALESCE(
  (SELECT MIN(i."documentDate") FROM "Invoice" i WHERE i."customerId" = c.id AND i."type" = 'RENTAL'),
  c."subscriptionStart"
)
WHERE c."subscriptionStart" IS NOT NULL OR c."subscriptionEnd" IS NOT NULL;

-- Plan end: fixed term length from planStartDate. Postgres's date+interval
-- month arithmetic already clamps end-of-month overflow correctly (verified:
-- 31 Jan + 1 month = 28/29 Feb), matching addBillingMonths()'s behavior.
UPDATE "Customer" c
SET "planEndDate" = c."planStartDate" + (COALESCE(c."rentalPlanDuration", c."planDuration") || ' months')::interval
WHERE c."planStartDate" IS NOT NULL;

ALTER TABLE "Customer"
  DROP COLUMN "subscriptionStart",
  DROP COLUMN "subscriptionEnd";
