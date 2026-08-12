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
// This is where a Draft actually becomes a Customer. Registration itself
// (customer.controller.register) only ever writes a Draft; nothing shows up
// under Customers until the security-deposit payment is verified here. If
// the signature is invalid (payment failed/cancelled/tampered), the Draft is
// left untouched so the person can be followed up with or retry later.
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
        const draft = await prisma_1.prisma.customerDraft.findUnique({ where: { id: draftId } });
        if (!draft) {
            return res.status(404).json({ success: false, message: "Registration draft not found. Please fill the form again." });
        }
        if (!draft.fullName || !draft.mobileNumber || !draft.email || !draft.addressLine1 || !draft.city || !draft.state || !draft.pincode || !draft.planDuration || !draft.houseType) {
            return res.status(400).json({ success: false, message: "Registration details are incomplete." });
        }
        // Guard against the same draft racing to pay twice (e.g. two tabs), or
        // the mobile number having been registered elsewhere in the meantime.
        const existingCustomer = await prisma_1.prisma.customer.findUnique({ where: { mobileNumber: draft.mobileNumber } });
        if (existingCustomer) {
            return res.status(400).json({ success: false, message: "A customer with this mobile number is already registered." });
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
                razorpayOrderId: razorpay_order_id,
                razorpayPaymentId: razorpay_payment_id
            }
        });
        // The draft has now become a real customer, so it must not keep
        // lingering around as a separate "incomplete registration".
        await prisma_1.prisma.customerDraft.delete({ where: { id: draftId } });
        const invoice = await (0, invoice_service_1.createInvoice)({
            type: "SECURITY_DEPOSIT",
            customerId: customer.id,
            productType: "Refundable Security Deposit",
            amount: (0, invoice_service_1.securityDepositAmount)(customer.planDuration),
            paymentMethod: "Razorpay",
            transactionId: razorpay_payment_id,
            status: "FUNDED"
        });
        return res.json({ success: true, message: "Payment verified successfully", customerId: customer.id, invoiceId: invoice.id });
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