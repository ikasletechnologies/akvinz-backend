"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOrder = createOrder;
exports.verifyPayment = verifyPayment;
exports.verifyRentalPayment = verifyRentalPayment;
const prisma_1 = require("../config/prisma");
const razorpay_1 = require("../config/razorpay");
const payment_service_1 = require("../services/payment.service");
const billing_1 = require("../utils/billing");
const invoice_service_1 = require("../services/invoice.service");
async function createOrder(req, res) {
    try {
        const { amount } = req.body;
        if (!amount) {
            return res.status(400).json({ success: false, message: "Amount is required" });
        }
        const options = {
            amount: amount * 100, // amount in smallest currency unit (paise)
            currency: "INR",
            receipt: `receipt_order_${Date.now()}`
        };
        const order = await razorpay_1.razorpay.orders.create(options);
        res.json({ success: true, order });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}
async function verifyPayment(req, res) {
    try {
        const { customerId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
        const isValid = (0, payment_service_1.verifyRazorpaySignature)(razorpay_order_id, razorpay_payment_id, razorpay_signature);
        if (isValid) {
            let invoiceId;
            if (customerId) {
                const customer = await prisma_1.prisma.customer.update({
                    where: { id: customerId },
                    data: {
                        paymentStatus: "COMPLETED",
                        razorpayOrderId: razorpay_order_id,
                        razorpayPaymentId: razorpay_payment_id
                    }
                });
                const invoice = await (0, invoice_service_1.createInvoice)({
                    type: "SECURITY_DEPOSIT",
                    customerId: customer.id,
                    productType: "Refundable Security Deposit",
                    amount: (0, invoice_service_1.securityDepositAmount)(customer.planDuration),
                    paymentMethod: "Razorpay",
                    transactionId: razorpay_payment_id,
                    status: "FUNDED"
                });
                invoiceId = invoice.id;
            }
            return res.json({ success: true, message: "Payment verified successfully", invoiceId });
        }
        else {
            if (customerId) {
                await prisma_1.prisma.customer.update({
                    where: { id: customerId },
                    data: {
                        paymentStatus: "FAILED",
                        razorpayOrderId: razorpay_order_id,
                        razorpayPaymentId: razorpay_payment_id
                    }
                });
            }
            return res.status(400).json({ success: false, message: "Invalid signature sent!" });
        }
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}
async function verifyRentalPayment(req, res) {
    try {
        const { customerId, rentalPlanDuration, rentalAmount, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
        const isValid = (0, payment_service_1.verifyRazorpaySignature)(razorpay_order_id, razorpay_payment_id, razorpay_signature);
        if (isValid) {
            let invoiceId;
            if (customerId) {
                const newStart = new Date();
                const billingDay = newStart.getDate();
                const newEnd = (0, billing_1.calculateNextBillingDate)(newStart, billingDay, "MONTHLY");
                await prisma_1.prisma.customer.update({
                    where: { id: customerId },
                    data: {
                        rentalPlanDuration,
                        rentalAmount,
                        subscriptionStatus: "ACTIVE",
                        subscriptionStart: newStart,
                        subscriptionEnd: newEnd,
                        billingDay,
                        lastPaymentDate: newStart,
                        razorpayOrderId: razorpay_order_id,
                        razorpayPaymentId: razorpay_payment_id
                    }
                });
                const invoice = await (0, invoice_service_1.createInvoice)({
                    type: "RENTAL",
                    customerId,
                    productType: "Water Purifier",
                    amount: rentalAmount,
                    paymentMethod: "Razorpay",
                    transactionId: razorpay_payment_id,
                    status: "FUNDED"
                });
                invoiceId = invoice.id;
            }
            return res.json({ success: true, message: "Rental Payment verified successfully", invoiceId });
        }
        else {
            return res.status(400).json({ success: false, message: "Invalid signature sent!" });
        }
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}
//# sourceMappingURL=payment.controller.js.map