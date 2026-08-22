import { prisma } from "../config/prisma";
import { razorpay } from "../config/razorpay";
import { createInvoice } from "./invoice.service";
import { applyPlanChange } from "./planChange.service";

// Shared by the Razorpay webhook (automatic), the admin's manual
// "Mark as Paid" fallback, and active Razorpay API sync, so all paths flip
// status the same way and produce a receipt in Invoices. Idempotent — calling
// it on an already-PAID record is a no-op.
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

// Queries Razorpay directly for any pending (CREATED) payment links for a
// customer and synchronizes their status. This ensures that if a webhook was
// missed or delayed (or during local development), payments made on Razorpay
// are immediately detected and applied without getting stuck.
export async function syncCustomerPaymentLinks(customerId: string) {
  const pendingLinks = await prisma.paymentLinkRequest.findMany({
    where: {
      customerId,
      status: "CREATED",
      razorpayPaymentLinkId: { not: null }
    }
  });

  if (pendingLinks.length === 0) {
    return { synced: 0, updated: false };
  }

  let updatedAny = false;

  for (const link of pendingLinks) {
    try {
      if (!link.razorpayPaymentLinkId) continue;
      const rzpLink: any = await razorpay.paymentLink.fetch(link.razorpayPaymentLinkId);

      if (rzpLink.status === "paid") {
        const lastPayment = Array.isArray(rzpLink.payments) && rzpLink.payments.length > 0
          ? rzpLink.payments[rzpLink.payments.length - 1]
          : null;
        const transactionId = lastPayment?.payment_id || rzpLink.payment_id || null;

        await markPaymentLinkPaid(link.id, transactionId);
        updatedAny = true;
      } else if (rzpLink.status === "expired") {
        await prisma.paymentLinkRequest.update({
          where: { id: link.id },
          data: { status: "EXPIRED" }
        });
        updatedAny = true;
      } else if (rzpLink.status === "cancelled") {
        await prisma.paymentLinkRequest.update({
          where: { id: link.id },
          data: { status: "CANCELLED" }
        });
        updatedAny = true;
      }
    } catch (err: any) {
      console.warn(`[syncCustomerPaymentLinks] Failed to fetch link ${link.razorpayPaymentLinkId}:`, err?.message || err);
    }
  }

  return { synced: pendingLinks.length, updated: updatedAny };
}

