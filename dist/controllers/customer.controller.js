"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.register = register;
exports.saveDraft = saveDraft;
exports.getDraft = getDraft;
exports.getCustomerByMobile = getCustomerByMobile;
exports.requestReturn = requestReturn;
exports.closeAccount = closeAccount;
const prisma_1 = require("../config/prisma");
const fileUrl_1 = require("../utils/fileUrl");
const invoice_service_1 = require("../services/invoice.service");
async function register(req, res) {
    try {
        const { fullName, mobileNumber, email, addressLine1, addressLine2, city, state, pincode, planDuration, houseType } = req.body;
        const files = req.files;
        const customer = await prisma_1.prisma.customer.create({
            data: {
                fullName,
                mobileNumber,
                email,
                addressLine1,
                addressLine2: addressLine2 || null,
                city,
                state,
                pincode,
                planDuration: parseInt(planDuration),
                houseType,
                aadharFrontImageUrl: (0, fileUrl_1.buildFileUrl)(files, "aadharFrontFile"),
                aadharBackImageUrl: (0, fileUrl_1.buildFileUrl)(files, "aadharBackFile"),
                panFrontImageUrl: (0, fileUrl_1.buildFileUrl)(files, "panFrontFile"),
                panBackImageUrl: (0, fileUrl_1.buildFileUrl)(files, "panBackFile"),
                residenceDocUrl: (0, fileUrl_1.buildFileUrl)(files, "residenceFile"),
                paymentStatus: "PENDING"
            }
        });
        res.json({ success: true, customerId: customer.id });
    }
    catch (error) {
        console.error("Registration Error:", error);
        if (error.code === 'P2002') {
            return res.status(400).json({ success: false, message: "A user with this email already exists." });
        }
        res.status(500).json({ success: false, message: error.message });
    }
}
async function saveDraft(req, res) {
    try {
        const { draftId, fullName, mobileNumber, email, addressLine1, addressLine2, city, state, pincode, planDuration, houseType, residenceDocType } = req.body;
        if (!draftId) {
            return res.status(400).json({ success: false, message: "draftId is required" });
        }
        const data = {
            fullName,
            mobileNumber,
            email,
            addressLine1,
            addressLine2,
            city,
            state,
            pincode,
            planDuration: planDuration ? parseInt(planDuration) : undefined,
            houseType,
            residenceDocType
        };
        const draft = await prisma_1.prisma.customerDraft.upsert({
            where: { id: draftId },
            update: data,
            create: { id: draftId, ...data }
        });
        res.json({ success: true, draft });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}
async function getDraft(req, res) {
    try {
        const draft = await prisma_1.prisma.customerDraft.findUnique({ where: { id: req.params.draftId } });
        if (!draft) {
            return res.status(404).json({ success: false, message: "Draft not found" });
        }
        res.json({ success: true, draft });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}
async function getCustomerByMobile(req, res) {
    try {
        const { mobileNumber } = req.params;
        const mobileWithoutCode = mobileNumber.replace(/^\+91/, "");
        const customer = await prisma_1.prisma.customer.findFirst({
            where: {
                OR: [
                    { mobileNumber: mobileNumber },
                    { mobileNumber: mobileWithoutCode },
                    { mobileNumber: `+91${mobileWithoutCode}` }
                ]
            },
            orderBy: {
                createdAt: 'desc'
            }
        });
        if (!customer) {
            return res.status(404).json({ success: false, message: "Customer not found" });
        }
        res.json({ success: true, customer });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}
async function requestReturn(req, res) {
    try {
        const { customerId } = req.body;
        if (!customerId) {
            return res.status(400).json({ success: false, message: "customerId is required" });
        }
        const customer = await prisma_1.prisma.customer.findUnique({ where: { id: customerId } });
        if (!customer) {
            return res.status(404).json({ success: false, message: "Customer not found" });
        }
        if (customer.subscriptionStatus !== "ACTIVE") {
            return res.status(400).json({ success: false, message: "No active subscription to discontinue" });
        }
        const updated = await prisma_1.prisma.customer.update({
            where: { id: customerId },
            data: {
                subscriptionStatus: "CANCELLED",
                returnRequested: true,
                returnRequestedAt: new Date(),
                // A completed advance payment becomes refundable once the product is being returned;
                // the admin fixes the final refundAmount after the technician reports its condition.
                ...(customer.paymentStatus === "COMPLETED" ? { paymentStatus: "PENDING_REFUND" } : {})
            }
        });
        res.json({ success: true, customer: updated });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}
// Final step of the close-agreement flow: only usable once the admin has inspected the
// returned product and fixed a refundAmount. The customer just confirms that fixed number.
async function closeAccount(req, res) {
    try {
        const { customerId } = req.body;
        if (!customerId) {
            return res.status(400).json({ success: false, message: "customerId is required" });
        }
        const customer = await prisma_1.prisma.customer.findUnique({ where: { id: customerId } });
        if (!customer) {
            return res.status(404).json({ success: false, message: "Customer not found" });
        }
        if (customer.paymentStatus !== "PENDING_REFUND") {
            return res.status(400).json({ success: false, message: "No pending refund found for this account" });
        }
        if (customer.refundAmount === null) {
            return res.status(400).json({ success: false, message: "Refund amount has not been finalized yet" });
        }
        const updated = await prisma_1.prisma.customer.update({
            where: { id: customerId },
            data: { paymentStatus: "REFUNDED" }
        });
        const invoice = await (0, invoice_service_1.createInvoice)({
            type: "REFUND",
            customerId,
            productType: "Security Deposit Refund",
            amount: customer.refundAmount,
            paymentMethod: "Manual",
            status: "REFUNDED",
            reason: "Refund of security deposit following product return"
        });
        res.json({ success: true, customer: updated, invoiceId: invoice.id });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}
//# sourceMappingURL=customer.controller.js.map