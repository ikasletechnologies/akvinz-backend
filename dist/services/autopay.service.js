"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activateRentalCycle = activateRentalCycle;
exports.createAutopaySubscription = createAutopaySubscription;
exports.cancelAutopay = cancelAutopay;
const prisma_1 = require("../config/prisma");
const razorpay_1 = require("../config/razorpay");
const invoice_service_1 = require("./invoice.service");
const billing_1 = require("../utils/billing");
// Shared by the manual monthly payment (verifyRentalPayment) and the first
// charge of a freshly-authorized autopay mandate (verifyAutopaySetup) — both
// end with the subscription activated and one RENTAL invoice, recorded
// identically regardless of which path triggered it.
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
    const newStart = new Date();
    const billingDay = newStart.getDate();
    const newEnd = (0, billing_1.calculateNextBillingDate)(newStart, billingDay, "MONTHLY");
    const customer = await prisma_1.prisma.customer.update({
        where: { id: customerId },
        data: {
            rentalPlanDuration: input.rentalPlanDuration,
            rentalAmount: input.rentalAmount,
            subscriptionStatus: "ACTIVE",
            subscriptionStart: newStart,
            subscriptionEnd: newEnd,
            billingDay,
            lastPaymentDate: newStart,
            razorpayPaymentId: input.transactionId,
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
        status: "FUNDED"
    });
    return { customer, invoice };
}
// Creates a Razorpay Plan + Subscription for this customer's rent. The
// mandate is UPI-app-agnostic (GPay/PhonePe/Paytm/etc.) — Razorpay Checkout
// presents whatever the customer's bank supports. total_count=100 monthly
// cycles (~8 years) comfortably covers the 12/24-month committed plans plus
// the contract's month-to-month auto-renewal; a customer who somehow outlasts
// that would need a fresh mandate, which is an acceptable edge case for now.
async function createAutopaySubscription(customerId, rentalPlanDuration, rentalAmount) {
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
            autopayStatus: "PENDING_AUTH"
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