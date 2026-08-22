"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyPlanChange = applyPlanChange;
const prisma_1 = require("../config/prisma");
const invoice_service_1 = require("./invoice.service");
const planPricing_1 = require("../utils/planPricing");
const billing_1 = require("../utils/billing");
// Shared by the admin's manual "Confirm & Apply Plan Change" button and the
// automatic path (a plan-change top-up link being paid, via webhook or
// "Mark as Paid" — see paymentLink.service.ts). Both end up here so a plan
// change is recorded identically — customer fields updated, one auditable
// top-up/refund invoice — no matter which path triggered it.
async function applyPlanChange(input) {
    const { customerId, newPlanDuration, paymentMethod, transactionId } = input;
    const customer = await prisma_1.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) {
        return { status: "not_found" };
    }
    // Idempotent: if this customer is already on the target plan (e.g. two
    // top-up links for the same change both ended up paid), there is nothing
    // left to apply.
    if (customer.planDuration === newPlanDuration) {
        return { status: "already_on_plan", customer };
    }
    const oldDeposit = (0, planPricing_1.securityDepositAmount)(customer.planDuration);
    const newDeposit = (0, planPricing_1.securityDepositAmount)(newPlanDuration);
    const difference = newDeposit - oldDeposit;
    const reason = `Plan changed from ${customer.planDuration} to ${newPlanDuration} months`;
    const recordedAmount = Number.isFinite(input.amountHandled) && input.amountHandled >= 0
        ? input.amountHandled
        : Math.abs(difference);
    // planStartDate stays fixed (the term is still counted from the original
    // rent-start date, per business rule) — only the term LENGTH changes, so
    // planEndDate is the one thing here that needs recomputing. Nothing to
    // recompute yet if the customer hasn't made their first rent payment.
    const planEndDate = customer.planStartDate && customer.billingDay
        ? (0, billing_1.addBillingMonths)(customer.planStartDate, newPlanDuration, customer.billingDay)
        : customer.planEndDate;
    const updated = await prisma_1.prisma.customer.update({
        where: { id: customer.id },
        data: {
            planDuration: newPlanDuration,
            rentalPlanDuration: newPlanDuration,
            rentalAmount: (0, planPricing_1.rentalAmountForPlan)(newPlanDuration),
            planEndDate,
            // One-time proof for this specific downgrade — clear both so the next
            // downgrade can't be confirmed off a stale upload or refund id.
            planChangeRefundProofUrl: null,
            planChangeRazorpayRefundId: null,
            planChangeRefundStatus: "NOT_STARTED",
            planChangeRefundAmount: null
        }
    });
    const invoice = await (0, invoice_service_1.createInvoice)(difference > 0
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
        });
    return { status: "applied", customer: updated, invoice, difference, recordedAmount };
}
//# sourceMappingURL=planChange.service.js.map