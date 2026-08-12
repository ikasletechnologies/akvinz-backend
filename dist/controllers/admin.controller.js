"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.login = login;
exports.getStats = getStats;
exports.listCustomers = listCustomers;
exports.listDrafts = listDrafts;
exports.deleteDraft = deleteDraft;
exports.getCustomer = getCustomer;
exports.updateCustomer = updateCustomer;
exports.deleteCustomer = deleteCustomer;
exports.createPaymentLink = createPaymentLink;
exports.listCustomerPaymentLinks = listCustomerPaymentLinks;
exports.markPaymentLinkAsPaid = markPaymentLinkAsPaid;
exports.changePlan = changePlan;
exports.triggerRenewals = triggerRenewals;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const prisma_1 = require("../config/prisma");
const env_1 = require("../config/env");
const razorpay_1 = require("../config/razorpay");
const billing_service_1 = require("../services/billing.service");
const invoice_service_1 = require("../services/invoice.service");
const paymentLink_service_1 = require("../services/paymentLink.service");
const planPricing_1 = require("../utils/planPricing");
function login(req, res) {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ success: false, message: "Email and password are required" });
    }
    if (email !== env_1.env.admin.email || password !== env_1.env.admin.password) {
        return res.status(401).json({ success: false, message: "Invalid credentials" });
    }
    const token = jsonwebtoken_1.default.sign({ email, role: "admin" }, env_1.env.admin.jwtSecret, { expiresIn: "12h" });
    res.json({ success: true, token });
}
async function getStats(req, res) {
    try {
        const [totalCustomers, activeSubscriptions, pendingPayments, completedPayments, totalReturns, pendingRefunds, revenueAgg] = await Promise.all([
            prisma_1.prisma.customer.count(),
            prisma_1.prisma.customer.count({ where: { subscriptionStatus: "ACTIVE" } }),
            prisma_1.prisma.customer.count({ where: { paymentStatus: "PENDING" } }),
            prisma_1.prisma.customer.count({ where: { paymentStatus: "COMPLETED" } }),
            prisma_1.prisma.customer.count({ where: { returnRequested: true } }),
            prisma_1.prisma.customer.count({ where: { paymentStatus: "PENDING_REFUND" } }),
            prisma_1.prisma.customer.aggregate({ _sum: { rentalAmount: true } })
        ]);
        res.json({
            success: true,
            stats: {
                totalCustomers,
                activeSubscriptions,
                pendingPayments,
                completedPayments,
                totalReturns,
                pendingRefunds,
                totalRentalRevenue: revenueAgg._sum.rentalAmount || 0
            }
        });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}
async function listCustomers(req, res) {
    try {
        const { search, paymentStatus, subscriptionStatus, returnRequested, page = "1", limit = "20" } = req.query;
        const pageNum = Math.max(parseInt(page) || 1, 1);
        const limitNum = Math.min(Math.max(parseInt(limit) || 20, 1), 100);
        const where = {};
        if (search) {
            where.OR = [
                { fullName: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
                { mobileNumber: { contains: search, mode: "insensitive" } }
            ];
        }
        if (paymentStatus)
            where.paymentStatus = paymentStatus;
        if (subscriptionStatus)
            where.subscriptionStatus = subscriptionStatus;
        if (returnRequested)
            where.returnRequested = returnRequested === "true";
        const [customers, total] = await Promise.all([
            prisma_1.prisma.customer.findMany({
                where,
                orderBy: { createdAt: "desc" },
                skip: (pageNum - 1) * limitNum,
                take: limitNum
            }),
            prisma_1.prisma.customer.count({ where })
        ]);
        res.json({
            success: true,
            customers,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.ceil(total / limitNum)
            }
        });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}
async function listDrafts(req, res) {
    try {
        const { search, page = "1", limit = "20" } = req.query;
        const pageNum = Math.max(parseInt(page) || 1, 1);
        const limitNum = Math.min(Math.max(parseInt(limit) || 20, 1), 100);
        const where = {};
        if (search) {
            where.OR = [
                { fullName: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
                { mobileNumber: { contains: search, mode: "insensitive" } }
            ];
        }
        const [drafts, total] = await Promise.all([
            prisma_1.prisma.customerDraft.findMany({
                where,
                orderBy: { updatedAt: "desc" },
                skip: (pageNum - 1) * limitNum,
                take: limitNum
            }),
            prisma_1.prisma.customerDraft.count({ where })
        ]);
        res.json({
            success: true,
            drafts,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.ceil(total / limitNum)
            }
        });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}
async function deleteDraft(req, res) {
    try {
        await prisma_1.prisma.customerDraft.delete({ where: { id: req.params.id } });
        res.json({ success: true, message: "Draft deleted" });
    }
    catch (error) {
        if (error.code === "P2025") {
            return res.status(404).json({ success: false, message: "Draft not found" });
        }
        res.status(500).json({ success: false, message: error.message });
    }
}
async function getCustomer(req, res) {
    try {
        const customer = await prisma_1.prisma.customer.findUnique({ where: { id: req.params.id } });
        if (!customer) {
            return res.status(404).json({ success: false, message: "Customer not found" });
        }
        res.json({ success: true, customer });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}
async function updateCustomer(req, res) {
    try {
        const allowedFields = [
            "fullName", "mobileNumber", "email", "addressLine1", "addressLine2",
            "city", "state", "pincode", "planDuration", "houseType",
            "paymentStatus", "rentalPlanDuration", "rentalAmount",
            "subscriptionStatus", "subscriptionStart", "subscriptionEnd", "billingDay",
            "returnRequested", "refundAmount", "modelName", "machineSerialNumber"
        ];
        const data = {};
        for (const field of allowedFields) {
            if (req.body[field] !== undefined)
                data[field] = req.body[field];
        }
        if (data.subscriptionStart)
            data.subscriptionStart = new Date(data.subscriptionStart);
        if (data.subscriptionEnd)
            data.subscriptionEnd = new Date(data.subscriptionEnd);
        if (data.planDuration !== undefined)
            data.planDuration = parseInt(data.planDuration);
        if (data.rentalPlanDuration !== undefined)
            data.rentalPlanDuration = parseInt(data.rentalPlanDuration);
        if (data.rentalAmount !== undefined)
            data.rentalAmount = parseInt(data.rentalAmount);
        if (data.billingDay !== undefined)
            data.billingDay = data.billingDay === "" ? null : parseInt(data.billingDay);
        if (data.refundAmount !== undefined)
            data.refundAmount = data.refundAmount === "" ? null : parseInt(data.refundAmount);
        if (data.returnRequested !== undefined)
            data.returnRequested = data.returnRequested === true || data.returnRequested === "true";
        const customer = await prisma_1.prisma.customer.update({
            where: { id: req.params.id },
            data
        });
        res.json({ success: true, customer });
    }
    catch (error) {
        if (error.code === "P2025") {
            return res.status(404).json({ success: false, message: "Customer not found" });
        }
        if (error.code === "P2002") {
            return res.status(400).json({ success: false, message: "A customer with this email already exists." });
        }
        res.status(500).json({ success: false, message: error.message });
    }
}
async function deleteCustomer(req, res) {
    try {
        await prisma_1.prisma.customer.delete({ where: { id: req.params.id } });
        res.json({ success: true, message: "Customer deleted" });
    }
    catch (error) {
        if (error.code === "P2025") {
            return res.status(404).json({ success: false, message: "Customer not found" });
        }
        res.status(500).json({ success: false, message: error.message });
    }
}
async function createPaymentLink(req, res) {
    try {
        const amount = Number(req.body.amount);
        if (!amount || amount <= 0) {
            return res.status(400).json({ success: false, message: "A valid amount is required" });
        }
        const customer = await prisma_1.prisma.customer.findUnique({ where: { id: req.params.id } });
        if (!customer) {
            return res.status(404).json({ success: false, message: "Customer not found" });
        }
        const contact = customer.mobileNumber.startsWith("+")
            ? customer.mobileNumber
            : `+91${customer.mobileNumber.replace(/^0+/, "")}`;
        const paymentLink = await razorpay_1.razorpay.paymentLink.create({
            amount: Math.round(amount * 100),
            currency: "INR",
            description: `Payment for ${customer.fullName}`,
            customer: {
                name: customer.fullName,
                email: customer.email,
                contact
            },
            notify: { sms: false, email: false },
            reminder_enable: false,
            expire_by: Math.floor(Date.now() / 1000) + 3600
        });
        await prisma_1.prisma.paymentLinkRequest.create({
            data: {
                customerId: customer.id,
                amount,
                razorpayPaymentLinkId: paymentLink.id,
                shortUrl: paymentLink.short_url,
                expireBy: new Date(paymentLink.expire_by * 1000)
            }
        });
        res.json({ success: true, shortUrl: paymentLink.short_url, expireBy: paymentLink.expire_by });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.error?.description || error.message });
    }
}
async function listCustomerPaymentLinks(req, res) {
    try {
        const paymentLinks = await prisma_1.prisma.paymentLinkRequest.findMany({
            where: { customerId: req.params.id },
            orderBy: { createdAt: "desc" }
        });
        res.json({ success: true, paymentLinks });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}
// Fallback for when the Razorpay webhook hasn't fired (e.g. local dev, where
// Razorpay can't reach localhost) or is delayed — admin confirms payment
// after checking the Razorpay dashboard themselves.
async function markPaymentLinkAsPaid(req, res) {
    try {
        const updated = await (0, paymentLink_service_1.markPaymentLinkPaid)(req.params.linkId, null);
        if (!updated) {
            return res.status(404).json({ success: false, message: "Payment link not found" });
        }
        res.json({ success: true, paymentLink: updated });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}
// Switches a customer between the 12-month (₹2,999 deposit / ₹699 rental) and
// 24-month (₹3,999 deposit / ₹449 rental) plans. The deposit difference is
// recorded as a top-up invoice (upgrade) or a refund invoice (downgrade) so
// it stays auditable alongside the customer's other receipts.
async function changePlan(req, res) {
    try {
        const newPlanDuration = Number(req.body.newPlanDuration);
        if (newPlanDuration !== 12 && newPlanDuration !== 24) {
            return res.status(400).json({ success: false, message: "Plan must be 12 or 24 months" });
        }
        const customer = await prisma_1.prisma.customer.findUnique({ where: { id: req.params.id } });
        if (!customer) {
            return res.status(404).json({ success: false, message: "Customer not found" });
        }
        if (customer.planDuration === newPlanDuration) {
            return res.status(400).json({ success: false, message: "Customer is already on this plan" });
        }
        const oldDeposit = (0, planPricing_1.securityDepositAmount)(customer.planDuration);
        const newDeposit = (0, planPricing_1.securityDepositAmount)(newPlanDuration);
        const difference = newDeposit - oldDeposit;
        const reason = `Plan changed from ${customer.planDuration} to ${newPlanDuration} months`;
        // Admin can override the theoretical deposit difference with the amount
        // actually handled (e.g. a partial payment, or a rounding adjustment);
        // falls back to the computed difference if omitted or invalid.
        const requestedAmount = Number(req.body.amountHandled);
        const recordedAmount = Number.isFinite(requestedAmount) && requestedAmount >= 0
            ? requestedAmount
            : Math.abs(difference);
        const updated = await prisma_1.prisma.customer.update({
            where: { id: customer.id },
            data: {
                planDuration: newPlanDuration,
                rentalPlanDuration: newPlanDuration,
                rentalAmount: (0, planPricing_1.rentalAmountForPlan)(newPlanDuration)
            }
        });
        const invoice = await (0, invoice_service_1.createInvoice)(difference > 0
            ? {
                type: "SECURITY_DEPOSIT",
                customerId: customer.id,
                productType: "Security Deposit Top-up (Plan Upgrade)",
                amount: recordedAmount,
                paymentMethod: "Manual",
                status: "FUNDED",
                reason
            }
            : {
                type: "REFUND",
                customerId: customer.id,
                productType: "Security Deposit Refund (Plan Downgrade)",
                amount: recordedAmount,
                paymentMethod: "Manual",
                status: "REFUNDED",
                reason
            });
        res.json({ success: true, customer: updated, invoice, difference, recordedAmount });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}
async function triggerRenewals(_req, res) {
    try {
        const result = await (0, billing_service_1.processRenewals)();
        res.json({ success: true, ...result });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}
//# sourceMappingURL=admin.controller.js.map