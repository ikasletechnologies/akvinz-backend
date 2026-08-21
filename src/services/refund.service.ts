import { razorpay } from "../config/razorpay";
import { prisma } from "../config/prisma";
import { createInvoice } from "./invoice.service";

// Issues a Razorpay refund against the customer's original deposit payment
// — money returns to whatever card/UPI/wallet they originally paid with, no
// manual bank transfer needed. Razorpay itself enforces that the amount
// can't exceed what's still refundable on that payment, so there's no need
// to duplicate that math here — an over-refund attempt just comes back as
// an error from the API call below. Does NOT create an invoice — callers
// decide when/how the receipt for this refund gets recorded, since some
// (plan-change downgrades) have their own later "confirm" step that already
// does it, and creating one here too would double up into two receipts for
// the same money movement.
async function refundOriginalDeposit(customerId: string, amount: number, reason?: string) {
  // Earliest FUNDED security-deposit invoice — the original payment made at
  // registration. (A later plan-upgrade top-up would be a separate invoice;
  // this refunds against the original deposit, which covers the normal case.)
  const originalInvoice = await prisma.invoice.findFirst({
    where: { customerId, type: "SECURITY_DEPOSIT", status: "FUNDED" },
    orderBy: { createdAt: "asc" }
  });

  if (!originalInvoice) {
    throw new Error("No funded security deposit payment found to refund");
  }
  if (!originalInvoice.transactionId) {
    throw new Error("Original payment has no Razorpay transaction on record — cannot refund automatically");
  }

  return razorpay.payments.refund(originalInvoice.transactionId, {
    amount: Math.round(amount * 100),
    speed: "normal",
    notes: { customerId, reason: reason || "" }
  });
}

// Account-closure refund — issues the Razorpay refund AND records the
// receipt immediately, since closeAccount has no later confirmation step of
// its own to do that.
export async function refundSecurityDeposit(customerId: string, amount: number, reason?: string) {
  const refund = await refundOriginalDeposit(customerId, amount, reason);

  const invoice = await createInvoice({
    type: "REFUND",
    customerId,
    productType: "Security Deposit Refund",
    amount,
    paymentMethod: "Razorpay",
    transactionId: refund.id,
    status: "REFUNDED",
    reason: reason || null
  });

  return { refund, invoice };
}

// Plan-downgrade refund — issues the Razorpay refund only. The receipt for
// this money movement is created later, by applyPlanChange, once the admin
// clicks "Confirm & Apply Plan Change" (see admin.controller.changePlan,
// which reads planChangeRazorpayRefundId back off the customer and passes
// it through as the invoice's transactionId).
export async function refundPlanChangeDeposit(customerId: string, amount: number) {
  return refundOriginalDeposit(customerId, amount, "Deposit refund for plan downgrade (admin-initiated)");
}
