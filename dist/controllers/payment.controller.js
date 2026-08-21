"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOrder = createOrder;
exports.verifyPayment = verifyPayment;
exports.verifyRentalPayment = verifyRentalPayment;
const razorpay_1 = require("../config/razorpay");
const payment_service_1 = require("../services/payment.service");
const autopay_service_1 = require("../services/autopay.service");
const registration_service_1 = require("../services/registration.service");
async function createOrder(req, res) {
    try {
        const { amount, notes } = req.body;
        if (!amount) {
            return res.status(400).json({ success: false, message: "Amount is required" });
        }
        const options = {
            amount: amount * 100, // amount in smallest currency unit (paise)
            currency: "INR",
            receipt: `receipt_order_${Date.now()}`,
            // Attached so the order.paid webhook can identify what this order was
            // for (e.g. { draftId }) without depending on the customer's browser
            // to report back — see webhook.controller.ts.
            notes: notes || {}
        };
        const order = await razorpay_1.razorpay.orders.create(options);
        res.json({ success: true, order });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}
// This is where a Draft actually becomes a Customer. Registration itself
// (customer.controller.register) only ever writes a Draft; nothing shows up
// under Customers until the security-deposit payment is verified here. If
// the signature is invalid (payment failed/cancelled/tampered), the Draft is
// left untouched so the person can be followed up with or retry later.
//
// finalizeRegistration is idempotent and shared with the order.paid webhook
// (webhook.controller.ts) — if that already finished this same payment
// (e.g. the customer's browser closed right after paying), this just reports
// back the same customer/invoice instead of erroring or double-creating.
async function verifyPayment(req, res) {
    try {
        const { draftId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
        const isValid = (0, payment_service_1.verifyRazorpaySignature)(razorpay_order_id, razorpay_payment_id, razorpay_signature);
        if (!isValid) {
            return res.status(400).json({ success: false, message: "Invalid signature sent!" });
        }
        if (!draftId) {
            return res.status(400).json({ success: false, message: "draftId is required" });
        }
        const result = await (0, registration_service_1.finalizeRegistration)(draftId, razorpay_order_id, razorpay_payment_id);
        if (result.status === "draft_not_found") {
            return res.status(404).json({ success: false, message: "Registration draft not found. Please fill the form again." });
        }
        if (result.status === "incomplete") {
            return res.status(400).json({ success: false, message: "Registration details are incomplete." });
        }
        if (result.status === "mobile_conflict") {
            return res.status(400).json({ success: false, message: "A customer with this mobile number is already registered." });
        }
        if (result.status === "email_conflict") {
            return res.status(400).json({ success: false, message: "A customer with this email is already registered." });
        }
        return res.json({
            success: true,
            message: "Payment verified successfully",
            customerId: result.customer.id,
            invoiceId: result.invoiceId ?? undefined
        });
    }
    catch (error) {
        if (error.code === 'P2002') {
            return res.status(400).json({ success: false, message: "A customer with this mobile number or email is already registered." });
        }
        res.status(500).json({ success: false, error: error.message });
    }
}
async function verifyRentalPayment(req, res) {
    try {
        const { customerId, rentalPlanDuration, rentalAmount, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
        const isValid = (0, payment_service_1.verifyRazorpaySignature)(razorpay_order_id, razorpay_payment_id, razorpay_signature);
        if (!isValid) {
            return res.status(400).json({ success: false, message: "Invalid signature sent!" });
        }
        // A valid signature only proves this order_id/payment_id pair genuinely
        // came from Razorpay — it does NOT prove the payment was captured.
        // Razorpay's checkout can call this success path in states its own
        // backend later resolves as failed (a known gap for UPI intent, where
        // the bank's confirmation can arrive late or never) — see the "delay in
        // response from the UPI app" failure reason. Confirming status here
        // directly against Razorpay's API is what actually stops a failed
        // payment from producing a receipt.
        const payment = await razorpay_1.razorpay.payments.fetch(razorpay_payment_id);
        if (payment.status !== "captured") {
            return res.status(400).json({ success: false, message: `Payment not captured (status: ${payment.status}). No receipt was created.` });
        }
        let invoiceId;
        if (customerId) {
            const { invoice } = await (0, autopay_service_1.activateRentalCycle)(customerId, {
                rentalPlanDuration,
                rentalAmount,
                transactionId: razorpay_payment_id,
                orderId: razorpay_order_id,
                paymentMethod: "Razorpay"
            });
            invoiceId = invoice.id;
        }
        return res.json({ success: true, message: "Rental Payment verified successfully", invoiceId });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}
// Autopay setup is now admin-triggered (see admin.controller.ts's
// activateAutopay) — the customer authorizes on Razorpay's own hosted
// subscription page (its short_url), not through our Checkout.js, and
// confirmation arrives purely via the subscription.activated/charged webhook
// (webhook.controller.ts). There's no client-side callback to verify here
// anymore, so the old setupAutopay/verifyAutopaySetup pair was removed.
//# sourceMappingURL=payment.controller.js.map