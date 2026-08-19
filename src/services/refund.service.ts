import { razorpay } from "../config/razorpay";
import { prisma } from "../config/prisma";
import { createInvoice } from "./invoice.service";

// Refunds the customer's original security deposit payment directly through
// Razorpay — money returns to whatever card/UPI/wallet they originally paid
// with, no manual bank transfer needed. Razorpay itself enforces that the
// amount can't exceed what's still refundable on that payment, so there's no
// need to duplicate that math here — an over-refund attempt just comes back
// as an error from the API call below.
export async function refundSecurityDeposit(customerId: string, amount: number, reason?: string) {
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

  const refund = await razorpay.payments.refund(originalInvoice.transactionId, {
    amount: Math.round(amount * 100),
    speed: "normal",
    notes: { customerId, reason: reason || "" }
  });

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
