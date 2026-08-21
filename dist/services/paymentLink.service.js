"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.markPaymentLinkPaid = markPaymentLinkPaid;
const prisma_1 = require("../config/prisma");
const invoice_service_1 = require("./invoice.service");
const planChange_service_1 = require("./planChange.service");
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
    const paymentMethod = transactionId ? "Razorpay" : "Manual";
    const amount = Number(record.amount); // record.amount is a Prisma Decimal
    // A "Change Plan" top-up link paying off applies the plan change right
    // here — no separate manual "Confirm & Apply Plan Change" click needed.
    // applyPlanChange records its own (more specific) Security Deposit
    // Top-up/Refund receipt, so the generic "Payment Link Collection" one
    // below is skipped for these — otherwise the same payment would show up
    // as two receipts.
    if (record.planChangeTargetDuration) {
        await (0, planChange_service_1.applyPlanChange)({
            customerId: record.customerId,
            newPlanDuration: record.planChangeTargetDuration,
            amountHandled: amount,
            paymentMethod,
            transactionId
        });
    }
    else {
        await (0, invoice_service_1.createInvoice)({
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
//# sourceMappingURL=paymentLink.service.js.map