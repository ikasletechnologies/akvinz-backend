"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.finalizeRegistration = finalizeRegistration;
const prisma_1 = require("../config/prisma");
const invoice_service_1 = require("./invoice.service");
// This is where a Draft actually becomes a Customer. Two independent paths
// can call this for the same payment — the customer's browser (verifyPayment,
// right after Razorpay's checkout callback) and the order.paid webhook
// (server-to-server, so it still lands even if the browser closes/loses
// connection right after paying). Whichever runs first does the real work;
// the other just reports back the same result instead of erroring or
// double-creating the customer.
async function finalizeRegistration(draftId, razorpayOrderId, razorpayPaymentId) {
    const existingByOrder = await prisma_1.prisma.customer.findFirst({ where: { razorpayOrderId } });
    if (existingByOrder) {
        const invoice = await prisma_1.prisma.invoice.findFirst({
            where: { customerId: existingByOrder.id, type: "SECURITY_DEPOSIT" },
            orderBy: { createdAt: "desc" }
        });
        return { status: "already_finalized", customer: existingByOrder, invoiceId: invoice?.id ?? null };
    }
    const draft = await prisma_1.prisma.customerDraft.findUnique({ where: { id: draftId } });
    if (!draft) {
        return { status: "draft_not_found" };
    }
    if (!draft.fullName || !draft.mobileNumber || !draft.email || !draft.addressLine1 || !draft.city || !draft.state || !draft.pincode || !draft.planDuration || !draft.houseType) {
        return { status: "incomplete" };
    }
    const existingByMobile = await prisma_1.prisma.customer.findUnique({ where: { mobileNumber: draft.mobileNumber } });
    if (existingByMobile) {
        return { status: "mobile_conflict" };
    }
    // Belt-and-braces re-check: the draft-save step already rejects an email
    // that belongs to an existing Customer, but a draft created before that
    // check existed (or one that's simply been sitting around since) could
    // still reach here with a stale conflicting email — better to catch it
    // before payment than to let customer.create() throw after the money's
    // already moved.
    const existingByEmail = await prisma_1.prisma.customer.findUnique({ where: { email: draft.email } });
    if (existingByEmail) {
        return { status: "email_conflict" };
    }
    const customer = await prisma_1.prisma.customer.create({
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
    await prisma_1.prisma.customerDraft.delete({ where: { id: draftId } }).catch(() => { });
    const invoice = await (0, invoice_service_1.createInvoice)({
        type: "SECURITY_DEPOSIT",
        customerId: customer.id,
        productType: "Refundable Security Deposit",
        amount: (0, invoice_service_1.securityDepositAmount)(customer.planDuration),
        paymentMethod: "Razorpay",
        transactionId: razorpayPaymentId,
        status: "FUNDED"
    });
    return { status: "created", customer, invoiceId: invoice.id };
}
//# sourceMappingURL=registration.service.js.map