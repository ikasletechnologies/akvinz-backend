import { prisma } from "../config/prisma";
import { createInvoice } from "./invoice.service";
import { applyPlanChange } from "./planChange.service";

// Shared by the Razorpay webhook (automatic) and the admin's manual
// "Mark as Paid" fallback, so both paths flip status the same way and both
// produce a receipt in Invoices. Idempotent — calling it on an
// already-PAID record is a no-op.
export async function markPaymentLinkPaid(recordId: string, transactionId: string | null) {
  const record = await prisma.paymentLinkRequest.findUnique({ where: { id: recordId } });
  if (!record) return null;
  if (record.status === "PAID") return record;

  const updated = await prisma.paymentLinkRequest.update({
    where: { id: record.id },
    data: {
      status: "PAID",
      razorpayPaymentId: transactionId,
      paidAt: new Date()
    }
  });

  const paymentMethod = transactionId ? "Razorpay" : "Manual";
  const amount = Number(record.amount); // record.amount is a Prisma Decimal

  // A "Change Plan" top-up link paying off applies the plan change right
  // here — no separate manual "Confirm & Apply Plan Change" click needed.
  // applyPlanChange records its own (more specific) Security Deposit
  // Top-up/Refund receipt, so the generic "Payment Link Collection" one
  // below is skipped for these — otherwise the same payment would show up
  // as two receipts.
  if (record.planChangeTargetDuration) {
    await applyPlanChange({
      customerId: record.customerId,
      newPlanDuration: record.planChangeTargetDuration,
      amountHandled: amount,
      paymentMethod,
      transactionId
    });
  } else {
    await createInvoice({
      type: "PAYMENT_LINK",
      customerId: record.customerId,
      productType: "Payment Link Collection",
      amount,
      reason: record.reason,
      paymentMethod,
      transactionId,
      status: "FUNDED"
    });
  }

  return updated;
}
