import { prisma } from "../config/prisma";
import { createInvoice } from "./invoice.service";
import { securityDepositAmount, rentalAmountForPlan } from "../utils/planPricing";
import { addBillingMonths } from "../utils/billing";

interface ApplyPlanChangeInput {
  customerId: string;
  newPlanDuration: number;
  amountHandled?: number; // falls back to the computed deposit difference if omitted
  paymentMethod: "Manual" | "Razorpay";
  transactionId?: string | null;
}

// Shared by the admin's manual "Confirm & Apply Plan Change" button and the
// automatic path (a plan-change top-up link being paid, via webhook or
// "Mark as Paid" — see paymentLink.service.ts). Both end up here so a plan
// change is recorded identically — customer fields updated, one auditable
// top-up/refund invoice — no matter which path triggered it.
export async function applyPlanChange(input: ApplyPlanChangeInput) {
  const { customerId, newPlanDuration, paymentMethod, transactionId } = input;

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) {
    return { status: "not_found" as const };
  }
  // Idempotent: if this customer is already on the target plan (e.g. two
  // top-up links for the same change both ended up paid), there is nothing
  // left to apply.
  if (customer.planDuration === newPlanDuration) {
    return { status: "already_on_plan" as const, customer };
  }

  const oldDeposit = securityDepositAmount(customer.planDuration);
  const newDeposit = securityDepositAmount(newPlanDuration);
  const difference = newDeposit - oldDeposit;
  const reason = `Plan changed from ${customer.planDuration} to ${newPlanDuration} months`;

  const recordedAmount = Number.isFinite(input.amountHandled) && (input.amountHandled as number) >= 0
    ? (input.amountHandled as number)
    : Math.abs(difference);

  // planStartDate stays fixed (the term is still counted from the original
  // rent-start date, per business rule) — only the term LENGTH changes, so
  // planEndDate is the one thing here that needs recomputing. Nothing to
  // recompute yet if the customer hasn't made their first rent payment.
  const planEndDate = customer.planStartDate && customer.billingDay
    ? addBillingMonths(customer.planStartDate, newPlanDuration, customer.billingDay)
    : customer.planEndDate;

  const updated = await prisma.customer.update({
    where: { id: customer.id },
    data: {
      planDuration: newPlanDuration,
      rentalPlanDuration: newPlanDuration,
      rentalAmount: rentalAmountForPlan(newPlanDuration),
      planEndDate,
      // One-time proof for this specific downgrade — clear both so the next
      // downgrade can't be confirmed off a stale upload or refund id.
      planChangeRefundProofUrl: null,
      planChangeRazorpayRefundId: null,
      planChangeRefundStatus: "NOT_STARTED",
      planChangeRefundAmount: null
    }
  });

  const invoice = await createInvoice(
    difference > 0
      ? {
          type: "SECURITY_DEPOSIT",
          customerId: customer.id,
          productType: "Security Deposit Top-up (Plan Upgrade)",
          amount: recordedAmount,
          paymentMethod,
          transactionId,
          status: "FUNDED",
          reason
        }
      : {
          type: "REFUND",
          customerId: customer.id,
          productType: "Security Deposit Refund (Plan Downgrade)",
          amount: recordedAmount,
          paymentMethod,
          transactionId,
          status: "REFUNDED",
          reason
        }
  );

  return { status: "applied" as const, customer: updated, invoice, difference, recordedAmount };
}
