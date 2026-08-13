import { prisma } from "../config/prisma";
import { createInvoice, securityDepositAmount } from "./invoice.service";

type FinalizeRegistrationResult =
  | { status: "already_finalized"; customer: Awaited<ReturnType<typeof prisma.customer.findFirst>>; invoiceId: string | null }
  | { status: "draft_not_found" }
  | { status: "incomplete" }
  | { status: "mobile_conflict" }
  | { status: "created"; customer: Awaited<ReturnType<typeof prisma.customer.create>>; invoiceId: string };

// This is where a Draft actually becomes a Customer. Two independent paths
// can call this for the same payment — the customer's browser (verifyPayment,
// right after Razorpay's checkout callback) and the order.paid webhook
// (server-to-server, so it still lands even if the browser closes/loses
// connection right after paying). Whichever runs first does the real work;
// the other just reports back the same result instead of erroring or
// double-creating the customer.
export async function finalizeRegistration(
  draftId: string,
  razorpayOrderId: string,
  razorpayPaymentId: string
): Promise<FinalizeRegistrationResult> {
  const existingByOrder = await prisma.customer.findFirst({ where: { razorpayOrderId } });
  if (existingByOrder) {
    const invoice = await prisma.invoice.findFirst({
      where: { customerId: existingByOrder.id, type: "SECURITY_DEPOSIT" },
      orderBy: { createdAt: "desc" }
    });
    return { status: "already_finalized", customer: existingByOrder, invoiceId: invoice?.id ?? null };
  }

  const draft = await prisma.customerDraft.findUnique({ where: { id: draftId } });
  if (!draft) {
    return { status: "draft_not_found" };
  }
  if (!draft.fullName || !draft.mobileNumber || !draft.email || !draft.addressLine1 || !draft.city || !draft.state || !draft.pincode || !draft.planDuration || !draft.houseType) {
    return { status: "incomplete" };
  }

  const existingByMobile = await prisma.customer.findUnique({ where: { mobileNumber: draft.mobileNumber } });
  if (existingByMobile) {
    return { status: "mobile_conflict" };
  }

  const customer = await prisma.customer.create({
    data: {
      fullName: draft.fullName,
      mobileNumber: draft.mobileNumber,
      email: draft.email,
      addressLine1: draft.addressLine1,
      addressLine2: draft.addressLine2,
      city: draft.city,
      state: draft.state,
      pincode: draft.pincode,
      planDuration: draft.planDuration,
      houseType: draft.houseType,
      aadharFrontImageUrl: draft.aadharFrontImageUrl,
      aadharBackImageUrl: draft.aadharBackImageUrl,
      panFrontImageUrl: draft.panFrontImageUrl,
      panBackImageUrl: draft.panBackImageUrl,
      residenceDocUrl: draft.residenceDocUrl,
      paymentStatus: "COMPLETED",
      razorpayOrderId,
      razorpayPaymentId
    }
  });

  // The draft has now become a real customer, so it must not keep lingering
  // around as a separate "incomplete registration". If the other path (client
  // or webhook) already deleted it in the race, that's fine — nothing to do.
  await prisma.customerDraft.delete({ where: { id: draftId } }).catch(() => {});

  const invoice = await createInvoice({
    type: "SECURITY_DEPOSIT",
    customerId: customer.id,
    productType: "Refundable Security Deposit",
    amount: securityDepositAmount(customer.planDuration),
    paymentMethod: "Razorpay",
    transactionId: razorpayPaymentId,
    status: "FUNDED"
  });

  return { status: "created", customer, invoiceId: invoice.id };
}
