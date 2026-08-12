"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.markPaymentLinkPaid = markPaymentLinkPaid;
const prisma_1 = require("../config/prisma");
const invoice_service_1 = require("./invoice.service");
// Shared by the Razorpay webhook (automatic) and the admin's manual
// "Mark as Paid" fallback, so both paths flip status the same way and both
// produce a receipt in Invoices. Idempotent — calling it on an
// already-PAID record is a no-op.
async function markPaymentLinkPaid(recordId, transactionId) {
    const record = await prisma_1.prisma.paymentLinkRequest.findUnique({ where: { id: recordId } });
    if (!record)
        return null;
    if (record.status === "PAID")
        return record;
    const updated = await prisma_1.prisma.paymentLinkRequest.update({
        where: { id: record.id },
        data: {
            status: "PAID",
            razorpayPaymentId: transactionId,
            paidAt: new Date()
        }
    });
    await (0, invoice_service_1.createInvoice)({
        type: "PAYMENT_LINK",
        customerId: record.customerId,
        productType: "Payment Link Collection",
        amount: record.amount,
        paymentMethod: transactionId ? "Razorpay" : "Manual",
        transactionId,
        status: "FUNDED"
    });
    return updated;
}
//# sourceMappingURL=paymentLink.service.js.map