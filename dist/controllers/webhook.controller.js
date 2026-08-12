"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.razorpayWebhook = razorpayWebhook;
const crypto_1 = __importDefault(require("crypto"));
const prisma_1 = require("../config/prisma");
const env_1 = require("../config/env");
const paymentLink_service_1 = require("../services/paymentLink.service");
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
    res.json({ success: true });
}
//# sourceMappingURL=webhook.controller.js.map