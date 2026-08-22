"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activateRentalCycle = activateRentalCycle;
exports.createAutopaySubscription = createAutopaySubscription;
exports.cancelAutopay = cancelAutopay;
const prisma_1 = require("../config/prisma");
const razorpay_1 = require("../config/razorpay");
const invoice_service_1 = require("./invoice.service");
const billing_1 = require("../utils/billing");
// Used by the one-time monthly rent payment (verifyRentalPayment) — marks
// the subscription active/current and records one RENTAL invoice. Autopay's
// own recurring charges are handled independently by the
// subscription.charged webhook (webhook.controller.ts), not this function.
async function activateRentalCycle(customerId, input) {
    // Idempotent: a duplicate client call (retry, double-submit, or a race
    // between the checkout handler and a webhook) for the same Razorpay
    // payment must not record it — and therefore charge the customer's plan
    // dates/invoice — twice. Mirrors the same guard already used on the
    // subscription.charged webhook handler.
    const existingInvoice = await prisma_1.prisma.invoice.findFirst({ where: { transactionId: input.transactionId } });
    if (existingInvoice) {
        const existingCustomer = await prisma_1.prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
        return { customer: existingCustomer, invoice: existingInvoice };
    }
    const existingCustomer = await prisma_1.prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    const newStart = new Date();
    const billingDay = newStart.getDate();
    // The next cycle's due date (when the following payment becomes due) —
    // used for renewal/overdue logic, e.g. 15 Aug -> 15 Sep.
    const nextRentDueDate = (0, billing_1.calculateNextBillingDate)(newStart, billingDay, "MONTHLY");
    // The last day THIS payment actually covers, one day before the next due
    // date — e.g. 15 Aug -> 14 Sep — shown on the bill as rentEndDate.
    const currentRentEndDate = new Date(nextRentDueDate);
    currentRentEndDate.setDate(currentRentEndDate.getDate() - 1);
    // planStartDate/planEndDate are the fixed whole 12/24-month term — set
    // once on the customer's first-ever rent payment and never touched again
    // by a routine renewal. A later plan upgrade/downgrade recomputes
    // planEndDate explicitly (see planChange.service.ts), not this function.
    const isFirstActivation = !existingCustomer.planStartDate;
    const planStartDate = isFirstActivation ? newStart : existingCustomer.planStartDate;
    const planEndDate = isFirstActivation
        ? (0, billing_1.addBillingMonths)(planStartDate, input.rentalPlanDuration, billingDay)
        : existingCustomer.planEndDate;
    const customer = await prisma_1.prisma.customer.update({
        where: { id: customerId },
        data: {
            rentalPlanDuration: input.rentalPlanDuration,
            rentalAmount: input.rentalAmount,
            subscriptionStatus: "ACTIVE",
            currentRentStartDate: newStart,
            currentRentEndDate,
            nextRentDueDate,
            billingDay,
            lastPaymentDate: newStart,
            razorpayPaymentId: input.transactionId,
            ...(isFirstActivation ? { planStartDate, planEndDate } : {}),
            ...(input.orderId ? { razorpayOrderId: input.orderId } : {})
        }
    });
    const invoice = await (0, invoice_service_1.createInvoice)({
        type: "RENTAL",
        customerId,
        productType: "Water Purifier",
        amount: input.rentalAmount,
        paymentMethod: input.paymentMethod,
        transactionId: input.transactionId,
        status: "FUNDED",
        rentStartDate: newStart,
        rentEndDate: currentRentEndDate
    });
    return { customer, invoice };
}
// Creates a Razorpay Plan + Subscription for this customer's rent. The
// mandate is UPI-app-agnostic (GPay/PhonePe/Paytm/etc.) — Razorpay Checkout
// (or the subscription's own short_url authorization page) presents whatever
// the customer's bank supports. total_count=100 monthly cycles (~8 years)
// comfortably covers the 12/24-month committed plans plus the contract's
// month-to-month auto-renewal; a customer who somehow outlasts that would
// need a fresh mandate, which is an acceptable edge case for now.
//
// Always creates a brand-new subscription — a cancelled Razorpay mandate can
// never be turned back on, so "activate autopay again" after a return is
// always a fresh mandate, not a reactivation. The one thing this guards
// against is creating a SECOND mandate on top of one that's already ACTIVE;
// a stale PENDING (an earlier attempt that was abandoned before
// authorization) is left retryable on purpose — this just overwrites it.
async function createAutopaySubscription(customerId, rentalPlanDuration, rentalAmount) {
    const customer = await prisma_1.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) {
        throw new Error("Customer not found");
    }
    if (customer.autopayStatus === "ACTIVE") {
        throw new Error("Autopay is already active for this customer");
    }
    const plan = await razorpay_1.razorpay.plans.create({
        period: "monthly",
        interval: 1,
        item: {
            name: `AKVINZ Rental Autopay - ${rentalPlanDuration} Month Plan`,
            amount: rentalAmount * 100,
            currency: "INR"
        }
    });
    const subscription = await razorpay_1.razorpay.subscriptions.create({
        plan_id: plan.id,
        customer_notify: 1,
        total_count: 100,
        // rentalPlanDuration is echoed back on every subscription.charged webhook
        // (see webhook.controller.ts) — that's a separate, faster delivery path
        // than the browser's own verify call, and has no other way to know which
        // plan this mandate is for.
        notes: { customerId, rentalPlanDuration: String(rentalPlanDuration) }
    });
    await prisma_1.prisma.customer.update({
        where: { id: customerId },
        data: {
            razorpayPlanId: plan.id,
            razorpaySubscriptionId: subscription.id,
            autopayStatus: "PENDING"
        }
    });
    return subscription;
}
// Cancels the customer's autopay mandate, if one exists. Safe to call even
// when there is none (e.g. a return request from a customer who never set
// up autopay) — it's a no-op in that case.
async function cancelAutopay(customerId) {
    const customer = await prisma_1.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer?.razorpaySubscriptionId)
        return;
    try {
        await razorpay_1.razorpay.subscriptions.cancel(customer.razorpaySubscriptionId);
    }
    catch (error) {
        // Already cancelled/expired on Razorpay's side — still clear our local
        // status so the dashboard doesn't keep showing it as active.
        if (error?.statusCode !== 400)
            throw error;
    }
    await prisma_1.prisma.customer.update({
        where: { id: customerId },
        data: { autopayStatus: "CANCELLED" }
    });
}
//# sourceMappingURL=autopay.service.js.map