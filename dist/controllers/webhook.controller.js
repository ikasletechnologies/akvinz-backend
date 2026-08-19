"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.razorpayWebhook = razorpayWebhook;
exports.razorpayxWebhook = razorpayxWebhook;
const crypto_1 = __importDefault(require("crypto"));
const prisma_1 = require("../config/prisma");
const env_1 = require("../config/env");
const paymentLink_service_1 = require("../services/paymentLink.service");
const registration_service_1 = require("../services/registration.service");
const autopay_service_1 = require("../services/autopay.service");
// Razorpay calls this with the raw request body (see app.ts, which mounts
// this route with express.raw() ahead of the global express.json()) so the
// HMAC signature can be verified against the exact bytes Razorpay signed.
async function razorpayWebhook(req, res) {
    const signature = req.headers["x-razorpay-signature"];
    const rawBody = req.body;
    if (!signature) {
        return res.status(400).json({ success: false, message: "Missing signature" });
    }
    const expectedSignature = crypto_1.default
        .createHmac("sha256", env_1.env.razorpay.webhookSecret)
        .update(rawBody)
        .digest("hex");
    if (signature !== expectedSignature) {
        return res.status(400).json({ success: false, message: "Invalid signature" });
    }
    const payload = JSON.parse(rawBody.toString("utf8"));
    if (payload.event === "payment_link.paid") {
        const linkEntity = payload.payload?.payment_link?.entity;
        const paymentEntity = payload.payload?.payment?.entity;
        if (linkEntity?.id) {
            const record = await prisma_1.prisma.paymentLinkRequest.findUnique({
                where: { razorpayPaymentLinkId: linkEntity.id }
            });
            if (record) {
                await (0, paymentLink_service_1.markPaymentLinkPaid)(record.id, paymentEntity?.id ?? null);
            }
        }
    }
    // Registration security deposit — server-to-server confirmation that a
    // draft's order was paid, independent of whether the customer's browser
    // stays connected long enough to call /verify-payment itself. Requires
    // draftId to have been attached to the order's notes at creation time
    // (customerForm.tsx's handlePayment -> /create-order).
    if (payload.event === "order.paid") {
        const orderEntity = payload.payload?.order?.entity;
        const paymentEntity = payload.payload?.payment?.entity;
        const draftId = orderEntity?.notes?.draftId;
        if (draftId && orderEntity?.id && paymentEntity?.id) {
            await (0, registration_service_1.finalizeRegistration)(draftId, orderEntity.id, paymentEntity.id);
        }
    }
    // Rental autopay (UPI Autopay / e-mandate) lifecycle — see autopay.service.ts
    // for how the subscription is first created and authorized.
    if (payload.event === "subscription.activated") {
        const subEntity = payload.payload?.subscription?.entity;
        if (subEntity?.id) {
            await prisma_1.prisma.customer.updateMany({
                where: { razorpaySubscriptionId: subEntity.id },
                data: { autopayStatus: "ACTIVE" }
            });
        }
    }
    if (payload.event === "subscription.charged") {
        const subEntity = payload.payload?.subscription?.entity;
        const paymentEntity = payload.payload?.payment?.entity;
        if (subEntity?.id && paymentEntity?.id) {
            const customer = await prisma_1.prisma.customer.findUnique({
                where: { razorpaySubscriptionId: subEntity.id }
            });
            if (customer) {
                await prisma_1.prisma.customer.update({
                    where: { id: customer.id },
                    data: { autopayStatus: "ACTIVE" }
                });
                // This is a server-to-server delivery racing the browser's own
                // /subscription/autopay/verify call for the exact same charge — it
                // usually arrives first. Both paths now funnel through
                // activateRentalCycle so whichever wins fully populates the
                // customer record (rentalPlanDuration, subscriptionStart,
                // billingDay, subscriptionEnd) instead of only the fields this
                // handler used to set directly; activateRentalCycle's own
                // transactionId check makes running it from both paths a no-op the
                // second time.
                //
                // rentalPlanDuration rides along in the subscription's notes (set
                // at creation in createAutopaySubscription) since Razorpay's
                // payload has no other way to say which plan this mandate is for.
                // Falls back to whatever plan is already on file for subscriptions
                // created before that note existed.
                const rentalPlanDuration = Number(subEntity.notes?.rentalPlanDuration) || customer.rentalPlanDuration || customer.planDuration;
                await (0, autopay_service_1.activateRentalCycle)(customer.id, {
                    rentalPlanDuration,
                    rentalAmount: Math.round((paymentEntity.amount ?? 0) / 100),
                    transactionId: paymentEntity.id,
                    paymentMethod: "Razorpay"
                });
            }
        }
    }
    // Razorpay's event for a recurring charge attempt that failed after
    // retries — the manual "Generate Payment Link" action in the admin
    // dashboard remains the fallback for collecting that month's rent.
    if (payload.event === "subscription.halted") {
        const subEntity = payload.payload?.subscription?.entity;
        if (subEntity?.id) {
            await prisma_1.prisma.customer.updateMany({
                where: { razorpaySubscriptionId: subEntity.id },
                data: { autopayStatus: "FAILED" }
            });
        }
    }
    if (payload.event === "subscription.cancelled" || payload.event === "subscription.completed") {
        const subEntity = payload.payload?.subscription?.entity;
        if (subEntity?.id) {
            await prisma_1.prisma.customer.updateMany({
                where: { razorpaySubscriptionId: subEntity.id },
                data: { autopayStatus: "CANCELLED" }
            });
        }
    }
    res.json({ success: true });
}
async function razorpayxWebhook(req, res) {
    const signature = req.headers["x-razorpay-signature"];
    const rawBody = req.body;
    if (!signature) {
        return res.status(400).json({ success: false, message: "Missing signature" });
    }
    const expectedSignature = crypto_1.default
        .createHmac("sha256", env_1.env.razorpay.webhookSecretX)
        .update(rawBody)
        .digest("hex");
    if (signature !== expectedSignature) {
        return res.status(400).json({ success: false, message: "Invalid signature" });
    }
    const payload = JSON.parse(rawBody.toString("utf8"));
    const eventId = payload.event_id;
    const eventType = payload.event;
    // Deduplication check
    if (eventId) {
        const existingEvent = await prisma_1.prisma.razorpayWebhookEvent.findUnique({
            where: { eventId }
        });
        if (existingEvent) {
            return res.json({ success: true, message: "Duplicate event skipped" });
        }
    }
    const payoutEntity = payload.payload?.payout?.entity;
    if (!payoutEntity || !payoutEntity.id) {
        return res.status(400).json({ success: false, message: "Invalid payout payload" });
    }
    const payoutId = payoutEntity.id;
    const razorpayStatus = payoutEntity.status; // e.g. 'processed', 'reversed', 'failed', 'rejected', 'queued', 'pending'
    const utr = payoutEntity.utr || null;
    const failureReason = payoutEntity.failure_reason || null;
    const statusDetails = payoutEntity.status_details || {};
    const statusReason = statusDetails.reason || failureReason || null;
    const statusDescription = statusDetails.description || null;
    // Map RazorpayX status to internal MoneyTransaction status
    let internalStatus = "PROCESSING";
    if (razorpayStatus === "processed") {
        internalStatus = "SUCCESS";
    }
    else if (razorpayStatus === "reversed") {
        internalStatus = "REVERSED";
    }
    else if (razorpayStatus === "failed") {
        internalStatus = "FAILED";
    }
    else if (razorpayStatus === "rejected") {
        internalStatus = "REJECTED";
    }
    else if (razorpayStatus === "queued") {
        internalStatus = "QUEUED";
    }
    else if (razorpayStatus === "pending") {
        internalStatus = "PENDING";
    }
    else if (razorpayStatus === "cancelled") {
        internalStatus = "CANCELLED";
    }
    const transaction = await prisma_1.prisma.moneyTransaction.findUnique({
        where: { razorpayPayoutId: payoutId }
    });
    if (transaction) {
        await prisma_1.prisma.moneyTransaction.update({
            where: { id: transaction.id },
            data: {
                status: internalStatus,
                razorpayPayoutStatus: razorpayStatus,
                razorpayUtr: utr || transaction.razorpayUtr,
                razorpayStatusReason: statusReason || transaction.razorpayStatusReason,
                razorpayStatusDescription: statusDescription || transaction.razorpayStatusDescription
            }
        });
    }
    // Save webhook event to prevent duplicate processing
    if (eventId) {
        await prisma_1.prisma.razorpayWebhookEvent.create({
            data: {
                eventId,
                eventType,
                payoutId,
            }
        });
    }
    res.json({ success: true });
}
//# sourceMappingURL=webhook.controller.js.map