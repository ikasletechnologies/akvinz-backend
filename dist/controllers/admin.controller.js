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
exports.triggerRenewals = triggerRenewals;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const prisma_1 = require("../config/prisma");
const env_1 = require("../config/env");
const billing_service_1 = require("../services/billing.service");
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