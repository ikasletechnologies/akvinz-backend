"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.register = register;
exports.saveDraft = saveDraft;
exports.getDraft = getDraft;
exports.getDraftByMobile = getDraftByMobile;
exports.getCustomerByMobile = getCustomerByMobile;
exports.requestReturn = requestReturn;
exports.updateBankDetails = updateBankDetails;
exports.closeAccount = closeAccount;
const prisma_1 = require("../config/prisma");
const fileUrl_1 = require("../utils/fileUrl");
const invoice_service_1 = require("../services/invoice.service");
const autopay_service_1 = require("../services/autopay.service");
// Shared by saveDraft (autosave while typing) and register (the final
// "submit registration" step, which now also just writes a draft — a
// Customer row is only ever created once payment succeeds, in verifyPayment).
// Keeps the "one draft per mobile number" and "mobile numbers/emails are
// only checked against real Customers" rules in one place.
async function upsertDraft(draftId, data) {
    const mobileNumber = data.mobileNumber ?? undefined;
    const email = data.email ?? undefined;
    if (mobileNumber) {
        const existingCustomer = await prisma_1.prisma.customer.findUnique({ where: { mobileNumber } });
        if (existingCustomer) {
            return { status: "customer_exists" };
        }
        // A draft for this mobile number may already exist under a different
        // draftId (e.g. a previous attempt on another device/browser, or after
        // local storage was cleared). Resume that row instead of letting a
        // second draft for the same person pile up.
        const existingDraft = await prisma_1.prisma.customerDraft.findUnique({ where: { mobileNumber } });
        if (existingDraft && existingDraft.id !== draftId) {
            const [, resumedDraft] = await prisma_1.prisma.$transaction([
                prisma_1.prisma.customerDraft.deleteMany({ where: { id: draftId } }),
                prisma_1.prisma.customerDraft.update({ where: { id: existingDraft.id }, data })
            ]);
            return { status: "ok", draft: resumedDraft, resumedDraftId: resumedDraft.id };
        }
    }
    // Same idea as the mobile check above — an email already tied to a real
    // Customer must not be allowed onto a new draft, otherwise the conflict
    // only surfaces after the customer has already paid the deposit (see
    // finalizeRegistration, which re-checks this at payment time too).
    if (email) {
        const existingCustomerByEmail = await prisma_1.prisma.customer.findUnique({ where: { email } });
        if (existingCustomerByEmail) {
            return { status: "email_exists" };
        }
    }
    const draft = await prisma_1.prisma.customerDraft.upsert({
        where: { id: draftId },
        update: data,
        create: { id: draftId, ...data }
    });
    return { status: "ok", draft };
}
// The final step of filling out the registration form. This does NOT create
// a Customer — it only finalizes the Draft (now including uploaded document
// URLs) so the person can proceed to payment. A Customer only comes into
// existence once that payment succeeds (see verifyPayment in
// payment.controller.ts). If payment is cancelled, fails, or is never
// completed, this row simply remains a Draft for follow-up.
async function register(req, res) {
    try {
        const { draftId, fullName, mobileNumber, email, addressLine1, addressLine2, city, state, pincode, planDuration, houseType, residenceDocType } = req.body;
        if (!draftId) {
            return res.status(400).json({ success: false, message: "draftId is required" });
        }
        const files = req.files;
        const data = {
            fullName,
            mobileNumber,
            email,
            addressLine1,
            addressLine2: addressLine2 || null,
            city,
            state,
            pincode,
            planDuration: planDuration ? parseInt(planDuration) : undefined,
            houseType,
            residenceDocType,
            // Fall back to undefined (not null) so re-submitting a resumed draft
            // without re-picking a file doesn't wipe out a document it already has.
            aadharFrontImageUrl: (0, fileUrl_1.buildFileUrl)(files, "aadharFrontFile") ?? undefined,
            aadharBackImageUrl: (0, fileUrl_1.buildFileUrl)(files, "aadharBackFile") ?? undefined,
            panFrontImageUrl: (0, fileUrl_1.buildFileUrl)(files, "panFrontFile") ?? undefined,
            panBackImageUrl: (0, fileUrl_1.buildFileUrl)(files, "panBackFile") ?? undefined,
            residenceDocUrl: (0, fileUrl_1.buildFileUrl)(files, "residenceFile") ?? undefined
        };
        const result = await upsertDraft(draftId, data);
        if (result.status === "customer_exists") {
            return res.status(400).json({ success: false, message: "A customer with this mobile number is already registered." });
        }
        if (result.status === "email_exists") {
            return res.status(400).json({ success: false, message: "A customer with this email is already registered." });
        }
        res.json({ success: true, draftId: result.draft.id });
    }
    catch (error) {
        console.error("Registration Error:", error);
        if (error.code === 'P2002') {
            return res.status(400).json({ success: false, message: "A customer with this mobile number is already registered." });
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
        const result = await upsertDraft(draftId, data);
        if (result.status === "customer_exists") {
            return res.status(409).json({
                success: false,
                code: "CUSTOMER_EXISTS",
                message: "This mobile number is already registered."
            });
        }
        if (result.status === "email_exists") {
            return res.status(409).json({
                success: false,
                code: "EMAIL_EXISTS",
                message: "This email is already registered."
            });
        }
        res.json({ success: true, draft: result.draft, resumedDraftId: result.resumedDraftId });
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
// Lets the registration form auto-resume an in-progress draft as soon as the
// customer types their mobile number, even without a `?draft=<id>` link.
async function getDraftByMobile(req, res) {
    try {
        const draft = await prisma_1.prisma.customerDraft.findUnique({ where: { mobileNumber: req.params.mobileNumber } });
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
        const { customerId, bankAccountHolderName, bankName, bankIfscCode, bankAccountNumber, bankAccountNumberConfirm } = req.body;
        if (!customerId) {
            return res.status(400).json({ success: false, message: "customerId is required" });
        }
        if (!bankAccountHolderName || !bankName || !bankIfscCode || !bankAccountNumber) {
            return res.status(400).json({ success: false, message: "Bank account details are required to process the refund" });
        }
        if (bankAccountNumber !== bankAccountNumberConfirm) {
            return res.status(400).json({ success: false, message: "Account number and confirmation do not match" });
        }
        const customer = await prisma_1.prisma.customer.findUnique({ where: { id: customerId } });
        if (!customer) {
            return res.status(404).json({ success: false, message: "Customer not found" });
        }
        if (customer.subscriptionStatus !== "ACTIVE" && customer.subscriptionStatus !== "PENDING_DUE") {
            return res.status(400).json({ success: false, message: "No active subscription to discontinue" });
        }
        const updated = await prisma_1.prisma.customer.update({
            where: { id: customerId },
            data: {
                subscriptionStatus: "CANCELLED",
                returnRequested: true,
                returnRequestedAt: new Date(),
                refundBankAccountHolderName: bankAccountHolderName,
                refundBankName: bankName,
                refundBankIfscCode: bankIfscCode,
                refundBankAccountNumber: bankAccountNumber,
                // A completed advance payment becomes refundable once the product is being returned;
                // the admin fixes the final refundAmount after the technician reports its condition.
                ...(customer.paymentStatus === "COMPLETED" ? { paymentStatus: "PENDING_REFUND" } : {})
            }
        });
        // Stop autopay from continuing to charge rent once the return is requested.
        await (0, autopay_service_1.cancelAutopay)(customerId);
        res.json({ success: true, customer: updated });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}
// Lets an already-registered customer submit/update a general bank account
// (bankDetailsForm) at any time — independent of a return/refund — so the
// admin has somewhere on file to send an ad-hoc manual payout. Separate
// from refundBank* above, which is collected specifically at return-request
// time and may legitimately differ (e.g. a different account for a refund).
async function updateBankDetails(req, res) {
    try {
        const { customerId, bankAccountHolderName, bankName, bankIfscCode, bankAccountNumber, bankAccountNumberConfirm } = req.body;
        if (!customerId) {
            return res.status(400).json({ success: false, message: "customerId is required" });
        }
        if (!bankAccountHolderName || !bankName || !bankIfscCode || !bankAccountNumber) {
            return res.status(400).json({ success: false, message: "All bank account details are required" });
        }
        if (bankAccountNumber !== bankAccountNumberConfirm) {
            return res.status(400).json({ success: false, message: "Account number and confirmation do not match" });
        }
        const customer = await prisma_1.prisma.customer.findUnique({ where: { id: customerId } });
        if (!customer) {
            return res.status(404).json({ success: false, message: "Customer not found" });
        }
        const updated = await prisma_1.prisma.customer.update({
            where: { id: customerId },
            data: { bankAccountHolderName, bankName, bankIfscCode, bankAccountNumber }
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