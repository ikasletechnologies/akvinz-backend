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
exports.createCustomer = createCustomer;
exports.uploadCustomerDocuments = uploadCustomerDocuments;
exports.deleteCustomerDocument = deleteCustomerDocument;
exports.getCustomer = getCustomer;
exports.getCustomerUpiVpa = getCustomerUpiVpa;
exports.updateCustomer = updateCustomer;
exports.deleteCustomer = deleteCustomer;
exports.createPaymentLink = createPaymentLink;
exports.activateAutopay = activateAutopay;
exports.listCustomerPaymentLinks = listCustomerPaymentLinks;
exports.createPayout = createPayout;
exports.listCustomerPayouts = listCustomerPayouts;
exports.refundNow = refundNow;
exports.markPaymentLinkAsPaid = markPaymentLinkAsPaid;
exports.changePlan = changePlan;
exports.refundPlanChangeViaRazorpay = refundPlanChangeViaRazorpay;
exports.requestRefundOtp = requestRefundOtp;
exports.verifyRefundOtpAndExecute = verifyRefundOtpAndExecute;
exports.cancelRefundOtp = cancelRefundOtp;
exports.requestPayoutOtp = requestPayoutOtp;
exports.verifyPayoutOtpAndExecute = verifyPayoutOtpAndExecute;
exports.cancelPayout = cancelPayout;
exports.getCustomerMoneyTransactions = getCustomerMoneyTransactions;
exports.triggerRenewals = triggerRenewals;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const prisma_1 = require("../config/prisma");
const env_1 = require("../config/env");
const razorpay_1 = require("../config/razorpay");
const twilio_1 = require("../config/twilio");
const billing_service_1 = require("../services/billing.service");
const paymentLink_service_1 = require("../services/paymentLink.service");
const planChange_service_1 = require("../services/planChange.service");
const invoice_service_1 = require("../services/invoice.service");
const refund_service_1 = require("../services/refund.service");
const planPricing_1 = require("../utils/planPricing");
const autopay_service_1 = require("../services/autopay.service");
const fileUrl_1 = require("../utils/fileUrl");
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
// Builds a Prisma date-range filter for a `from`/`to` query pair (both
// optional, either can be omitted). Returns undefined entirely when neither
// is set, so callers can spread it into a `where` clause without adding an
// empty {gte: undefined, lte: undefined} object. `to` is treated as
// inclusive of the whole day.
function dateRangeFilter(from, to) {
    if (!from && !to)
        return undefined;
    const filter = {};
    if (from)
        filter.gte = new Date(from);
    if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        filter.lte = end;
    }
    return filter;
}
// "Assets Received" has no single-query answer: it's the count of customers
// whose MOST RECENT MACHINE_RECEIVED_WAREHOUSE return-process event is
// COMPLETED. Fetches that step's events (small volume — one rental
// company's returns) and reduces to the latest per customer in JS, since
// Prisma has no "latest row per group" aggregate.
async function countAssetsReceived(range) {
    const events = await prisma_1.prisma.returnProcessEvent.findMany({
        where: { step: "MACHINE_RECEIVED_WAREHOUSE" },
        orderBy: { createdAt: "desc" },
        select: { customerId: true, status: true, eventDate: true }
    });
    const latestByCustomer = new Map();
    for (const event of events) {
        if (!latestByCustomer.has(event.customerId)) {
            latestByCustomer.set(event.customerId, { status: event.status, eventDate: event.eventDate });
        }
    }
    let count = 0;
    for (const { status, eventDate } of latestByCustomer.values()) {
        if (status !== "COMPLETED")
            continue;
        if (range?.gte && eventDate < range.gte)
            continue;
        if (range?.lte && eventDate > range.lte)
            continue;
        count += 1;
    }
    return count;
}
async function getStats(req, res) {
    try {
        const { from, to } = req.query;
        const range = dateRangeFilter(from, to);
        // A Subscriber = paid the security deposit (every Customer row implies
        // this — see finalizeRegistration/createCustomer, a row only exists
        // once payment succeeds) and hasn't finally been refunded/closed yet.
        // paymentStatus is COMPLETED -> PENDING_REFUND (return requested) ->
        // REFUNDED (closeAccount, the final step) — so "not REFUNDED" is the
        // whole condition. Deliberately NOT keyed off subscriptionStatus or
        // Invoice rows: subscriptionStatus flips to CANCELLED the moment a
        // return is *requested*, well before any refund happens, so it can't
        // tell an in-progress return apart from a completed one; and a
        // manually/offline-created customer (admin.controller.createCustomer)
        // never gets a SECURITY_DEPOSIT invoice at all, so relying on Invoice
        // rows silently excluded them.
        const subscriberWhere = { paymentStatus: { not: "REFUNDED" } };
        const [totalCustomers, totalSubscribers, twelveMonthCustomers, twentyFourMonthCustomers, rentalPaidInvoices, rentalDue, returnsInitiated, refundedInvoices, rentalRevenueAgg, totalDepositsAgg, assetsReceived] = await Promise.all([
            prisma_1.prisma.customer.count({ where: { createdAt: range } }),
            prisma_1.prisma.customer.count({ where: { ...subscriberWhere, createdAt: range } }),
            prisma_1.prisma.customer.count({ where: { ...subscriberWhere, planDuration: 12, createdAt: range } }),
            prisma_1.prisma.customer.count({ where: { ...subscriberWhere, planDuration: 24, createdAt: range } }),
            prisma_1.prisma.invoice.findMany({
                where: { type: "RENTAL", status: "FUNDED", createdAt: range },
                select: { customerId: true },
                distinct: ["customerId"]
            }),
            prisma_1.prisma.customer.count({ where: { subscriptionStatus: "PENDING_DUE", subscriptionEnd: range } }),
            prisma_1.prisma.customer.count({ where: { returnRequested: true, returnRequestedAt: range } }),
            prisma_1.prisma.invoice.findMany({
                where: { type: "REFUND", productType: "Security Deposit Refund", status: "REFUNDED", createdAt: range },
                select: { customerId: true },
                distinct: ["customerId"]
            }),
            prisma_1.prisma.invoice.aggregate({ where: { type: "RENTAL", status: "FUNDED", createdAt: range }, _sum: { amount: true } }),
            prisma_1.prisma.invoice.aggregate({ where: { type: "SECURITY_DEPOSIT", status: "FUNDED", createdAt: range }, _sum: { amount: true } }),
            countAssetsReceived(range)
        ]);
        res.json({
            success: true,
            stats: {
                totalCustomers,
                totalSubscribers,
                twelveMonthCustomers,
                twentyFourMonthCustomers,
                rentalPaid: rentalPaidInvoices.length,
                rentalDue,
                returnsInitiated,
                customersRefunded: refundedInvoices.length,
                rentalRevenue: Number(rentalRevenueAgg._sum.amount) || 0,
                totalDeposits: Number(totalDepositsAgg._sum.amount) || 0,
                assetsReceived
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
// Lets an admin add a customer directly — no OTP, no draft, no payment
// flow. Used for entries that happened outside the normal online journey
// (e.g. an offline/cash signup). paymentStatus is set to COMPLETED since
// there's no real online payment to leave PENDING against; PENDING isn't a
// selectable option in the admin edit form's Payment Status dropdown, so
// leaving it there would strand the customer with no way to change it via
// the UI.
async function createCustomer(req, res) {
    try {
        const { fullName, mobileNumber, email, addressLine1, addressLine2, city, state, pincode, planDuration, houseType } = req.body;
        if (!fullName || !mobileNumber || !email || !addressLine1 || !city || !state || !pincode || !planDuration || !houseType) {
            return res.status(400).json({ success: false, message: "Please fill in all required fields." });
        }
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
                paymentStatus: "COMPLETED",
                aadharFrontImageUrl: files ? (0, fileUrl_1.buildFileUrl)(files, "aadharFrontFile") : null,
                aadharBackImageUrl: files ? (0, fileUrl_1.buildFileUrl)(files, "aadharBackFile") : null,
                panFrontImageUrl: files ? (0, fileUrl_1.buildFileUrl)(files, "panFrontFile") : null,
                panBackImageUrl: files ? (0, fileUrl_1.buildFileUrl)(files, "panBackFile") : null,
                residenceDocUrl: files ? (0, fileUrl_1.buildFileUrl)(files, "residenceFile") : null
            }
        });
        res.json({ success: true, customer });
    }
    catch (error) {
        if (error.code === "P2002") {
            return res.status(400).json({ success: false, message: "A customer with this mobile number or email already exists." });
        }
        res.status(500).json({ success: false, message: error.message });
    }
}
// Upload field name -> Customer column, shared by both document endpoints
// below and matching the same upload field names /register already uses.
const DOCUMENT_UPLOAD_FIELDS = {
    aadharFrontFile: "aadharFrontImageUrl",
    aadharBackFile: "aadharBackImageUrl",
    panFrontFile: "panFrontImageUrl",
    panBackFile: "panBackImageUrl",
    residenceFile: "residenceDocUrl",
    planChangeRefundProofFile: "planChangeRefundProofUrl"
};
const DOCUMENT_DB_FIELDS = new Set(Object.values(DOCUMENT_UPLOAD_FIELDS));
// Lets an admin upload or replace a customer's KYC documents after the
// fact (e.g. a blurry scan, or one collected later than the others).
// Accepts any subset of the 5 file fields — only the ones present are
// updated, the rest are left as-is.
async function uploadCustomerDocuments(req, res) {
    try {
        const files = req.files;
        if (!files || Object.keys(files).length === 0) {
            return res.status(400).json({ success: false, message: "No file uploaded" });
        }
        const customerId = req.params.id;
        const existingCustomer = await prisma_1.prisma.customer.findUnique({ where: { id: customerId } });
        if (!existingCustomer) {
            return res.status(404).json({ success: false, message: "Customer not found" });
        }
        const data = {};
        for (const [uploadField, dbField] of Object.entries(DOCUMENT_UPLOAD_FIELDS)) {
            const url = (0, fileUrl_1.buildFileUrl)(files, uploadField);
            if (url)
                data[dbField] = url;
        }
        // Exclusivity check: reject manual proof if Razorpay refund has been initiated
        if (data.planChangeRefundProofUrl && (existingCustomer.planChangeRazorpayRefundId || existingCustomer.planChangeRefundStatus === "REFUND_SUCCESS" || existingCustomer.planChangeRefundStatus === "REFUND_PROCESSING")) {
            return res.status(400).json({
                success: false,
                message: "Cannot upload manual proof because a Razorpay refund has already been initiated/processed."
            });
        }
        const customer = await prisma_1.prisma.customer.update({
            where: { id: customerId },
            data
        });
        res.json({ success: true, customer });
    }
    catch (error) {
        if (error.code === "P2025") {
            return res.status(404).json({ success: false, message: "Customer not found" });
        }
        res.status(500).json({ success: false, message: error.message });
    }
}
async function deleteCustomerDocument(req, res) {
    try {
        const field = req.params.field;
        if (!DOCUMENT_DB_FIELDS.has(field)) {
            return res.status(400).json({ success: false, message: "Invalid document field" });
        }
        const customer = await prisma_1.prisma.customer.update({
            where: { id: req.params.id },
            data: { [field]: null }
        });
        res.json({ success: true, customer });
    }
    catch (error) {
        if (error.code === "P2025") {
            return res.status(404).json({ success: false, message: "Customer not found" });
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
// Looks up a customer's UPI VPA from their original security-deposit
// payment on demand, for customers who registered before customerUpiVpa
// started being captured automatically (registration.service.ts) — every
// customer already has razorpayPaymentId on file regardless of when they
// registered, so this works retroactively. Only returns something if that
// original payment was actually made via UPI; caches a hit back onto the
// customer so future lookups (and other admins) skip the Razorpay call.
async function getCustomerUpiVpa(req, res) {
    try {
        const customer = await prisma_1.prisma.customer.findUnique({ where: { id: req.params.id } });
        if (!customer) {
            return res.status(404).json({ success: false, message: "Customer not found" });
        }
        if (customer.customerUpiVpa) {
            return res.json({ success: true, upiVpa: customer.customerUpiVpa });
        }
        if (!customer.razorpayPaymentId) {
            return res.json({ success: true, upiVpa: null });
        }
        try {
            const payment = await razorpay_1.razorpay.payments.fetch(customer.razorpayPaymentId);
            const upiVpa = payment.method === "upi" && typeof payment.vpa === "string" ? payment.vpa : null;
            if (upiVpa) {
                await prisma_1.prisma.customer.update({ where: { id: customer.id }, data: { customerUpiVpa: upiVpa } });
            }
            res.json({ success: true, upiVpa });
        }
        catch {
            // Old/archived payment, API hiccup, etc. — not fatal, admin can still type it in.
            res.json({ success: true, upiVpa: null });
        }
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
            "returnRequested", "refundAmount", "modelName", "machineSerialNumber",
            "bankAccountHolderName", "bankName", "bankIfscCode", "bankAccountNumber"
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
    const customerId = req.params.id;
    try {
        // Deleting a customer also permanently erases their invoices, payment
        // links, payouts, and return-process history — there's no FK cascade in
        // the schema (invoices are normally kept as permanent billing records),
        // so it's done explicitly here in one transaction.
        await prisma_1.prisma.$transaction([
            prisma_1.prisma.invoice.deleteMany({ where: { customerId } }),
            prisma_1.prisma.returnProcessEvent.deleteMany({ where: { customerId } }),
            prisma_1.prisma.paymentLinkRequest.deleteMany({ where: { customerId } }),
            prisma_1.prisma.customerPayout.deleteMany({ where: { customerId } }),
            prisma_1.prisma.customer.delete({ where: { id: customerId } }),
        ]);
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
        // Set only when this link is generated from "Change Plan" as a deposit
        // top-up — once it's paid, the plan change applies automatically
        // instead of needing a separate manual confirmation.
        const planChangeTargetDuration = Number(req.body.planChangeTargetDuration);
        const hasPlanChangeTarget = planChangeTargetDuration === 12 || planChangeTargetDuration === 24;
        // The plan-change top-up link is self-explanatory and generated
        // programmatically, so it gets a fixed reason instead of asking the
        // admin to type one; every other "Collect From Customer" link requires
        // an explicit reason.
        const reason = hasPlanChangeTarget
            ? `Plan change top-up (${planChangeTargetDuration} months)`
            : typeof req.body.reason === "string" ? req.body.reason.trim() : "";
        if (!reason) {
            return res.status(400).json({ success: false, message: "A reason is required" });
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
                reason,
                razorpayPaymentLinkId: paymentLink.id,
                shortUrl: paymentLink.short_url,
                expireBy: new Date(paymentLink.expire_by * 1000),
                planChangeTargetDuration: hasPlanChangeTarget ? planChangeTargetDuration : null
            }
        });
        res.json({ success: true, shortUrl: paymentLink.short_url, expireBy: paymentLink.expire_by });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.error?.description || error.message });
    }
}
// Admin-triggered: creates a fresh Razorpay Subscription (never a
// reactivation of an old cancelled one — Razorpay doesn't support that) and
// hands back its short_url, the same way createPaymentLink above hands back
// a shareable link for a one-time payment. Autopay only flips to ACTIVE once
// the customer opens that link, authorizes it themselves, and Razorpay
// confirms via webhook (see webhook.controller.ts) — this call just starts
// that process, it does not activate anything itself.
async function activateAutopay(req, res) {
    try {
        const customer = await prisma_1.prisma.customer.findUnique({ where: { id: req.params.id } });
        if (!customer) {
            return res.status(404).json({ success: false, message: "Customer not found" });
        }
        if (!customer.rentalPlanDuration || !customer.rentalAmount) {
            return res.status(400).json({ success: false, message: "This customer has no established rental plan/amount yet — activate their rental first." });
        }
        const subscription = await (0, autopay_service_1.createAutopaySubscription)(customer.id, customer.rentalPlanDuration, customer.rentalAmount);
        res.json({ success: true, shortUrl: subscription.short_url });
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
        // amount is a Prisma Decimal — JSON.stringify would otherwise serialize
        // it as a string (e.g. "3.50") instead of a number.
        res.json({ success: true, paymentLinks: paymentLinks.map((p) => ({ ...p, amount: Number(p.amount) })) });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}
// "Pay Customer" — a manual, immediate payout with no Razorpay involved.
// Always Completed the moment it's recorded (there's nothing to wait on).
// Also produces a downloadable REFUND-type invoice (see Receipts) carrying
// the admin's typed reason, so every manual payout stays auditable.
async function createPayout(req, res) {
    try {
        const amount = Number(req.body.amount);
        const reason = String(req.body.reason || "").trim();
        if (!amount || amount <= 0) {
            return res.status(400).json({ success: false, message: "A valid amount is required" });
        }
        if (!reason) {
            return res.status(400).json({ success: false, message: "A reason is required" });
        }
        const files = req.files;
        const proofUrl = files ? (0, fileUrl_1.buildFileUrl)(files, "proofFile") : null;
        if (!proofUrl) {
            return res.status(400).json({ success: false, message: "Payment proof is required" });
        }
        const customer = await prisma_1.prisma.customer.findUnique({ where: { id: req.params.id } });
        if (!customer) {
            return res.status(404).json({ success: false, message: "Customer not found" });
        }
        const payout = await prisma_1.prisma.customerPayout.create({
            data: { customerId: customer.id, amount, reason, proofUrl }
        });
        const invoice = await (0, invoice_service_1.createInvoice)({
            type: "REFUND",
            customerId: customer.id,
            productType: reason,
            amount,
            paymentMethod: "Manual",
            status: "REFUNDED",
            reason
        });
        res.json({ success: true, payout, invoice });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}
async function listCustomerPayouts(req, res) {
    try {
        const payouts = await prisma_1.prisma.customerPayout.findMany({
            where: { customerId: req.params.id },
            orderBy: { createdAt: "desc" }
        });
        res.json({ success: true, payouts });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}
// Admin-triggered equivalent of the customer confirming on /closeForm —
// refunds the security deposit via Razorpay immediately instead of waiting
// on the customer to accept the fixed amount themselves.
async function refundNow(req, res) {
    try {
        const customer = await prisma_1.prisma.customer.findUnique({ where: { id: req.params.id } });
        if (!customer) {
            return res.status(404).json({ success: false, message: "Customer not found" });
        }
        if (customer.paymentStatus !== "PENDING_REFUND") {
            return res.status(400).json({ success: false, message: "No pending refund found for this account" });
        }
        if (customer.refundAmount === null) {
            return res.status(400).json({ success: false, message: "Refund amount has not been finalized yet" });
        }
        const { invoice } = await (0, refund_service_1.refundSecurityDeposit)(customer.id, customer.refundAmount, "Refund of security deposit following product return (admin-initiated)");
        const updated = await prisma_1.prisma.customer.update({
            where: { id: customer.id },
            data: { paymentStatus: "REFUNDED" }
        });
        res.json({ success: true, customer: updated, invoiceId: invoice.id });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.error?.description || error.message });
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
// Switches a customer between the 12-month and 24-month plans (amounts per
// planPricing.ts). The deposit difference is recorded as a top-up invoice
// (upgrade) or a refund invoice (downgrade) so it stays auditable alongside
// the customer's other receipts.
async function changePlan(req, res) {
    try {
        const newPlanDuration = Number(req.body.newPlanDuration);
        if (newPlanDuration !== 12 && newPlanDuration !== 24) {
            return res.status(400).json({ success: false, message: "Plan must be 12 or 24 months" });
        }
        const customerId = req.params.id;
        const customer = await prisma_1.prisma.customer.findUnique({ where: { id: customerId } });
        if (!customer) {
            return res.status(404).json({ success: false, message: "Customer not found" });
        }
        const difference = (0, planPricing_1.securityDepositAmount)(newPlanDuration) - (0, planPricing_1.securityDepositAmount)(customer.planDuration);
        if (difference < 0) {
            if (!customer.planChangeRefundProofUrl && customer.planChangeRefundStatus !== "REFUND_SUCCESS" && !customer.planChangeRazorpayRefundId) {
                return res.status(400).json({
                    success: false,
                    message: "Refund the deposit via Razorpay, or upload proof it was sent, before confirming this downgrade."
                });
            }
            // Verify Razorpay refund state if it exists
            if (customer.planChangeRazorpayRefundId) {
                try {
                    const refundObj = await razorpay_1.razorpay.refunds.fetch(customer.planChangeRazorpayRefundId);
                    if (refundObj.status === "failed") {
                        return res.status(400).json({
                            success: false,
                            message: "The Razorpay refund failed. Please retry the refund or settle manually."
                        });
                    }
                }
                catch (err) {
                    // If we fail to fetch (e.g. network issue), reject to prevent applying unpaid plan
                    return res.status(400).json({
                        success: false,
                        message: `Could not verify Razorpay refund status: ${err.message}`
                    });
                }
            }
        }
        if (difference > 0) {
            const paidTopUpLink = await prisma_1.prisma.paymentLinkRequest.findFirst({
                where: { customerId, status: "PAID", planChangeTargetDuration: newPlanDuration }
            });
            if (!paidTopUpLink) {
                return res.status(400).json({
                    success: false,
                    message: "Generate a top-up link and mark it as paid before confirming this upgrade."
                });
            }
        }
        const requestedAmount = Number(req.body.amountHandled);
        const result = await (0, planChange_service_1.applyPlanChange)({
            customerId,
            newPlanDuration,
            amountHandled: Number.isFinite(requestedAmount) && requestedAmount >= 0 ? requestedAmount : undefined,
            // A Razorpay auto-refund (see refundPlanChangeViaRazorpay below)
            // already has a real transaction id to attribute this receipt to;
            // otherwise it's the admin's manual proof-upload path.
            paymentMethod: customer.planChangeRazorpayRefundId ? "Razorpay" : "Manual",
            transactionId: customer.planChangeRazorpayRefundId
        });
        if (result.status === "not_found") {
            return res.status(404).json({ success: false, message: "Customer not found" });
        }
        if (result.status === "already_on_plan") {
            return res.status(400).json({ success: false, message: "Customer is already on this plan" });
        }
        res.json({ success: true, customer: result.customer, invoice: result.invoice, difference: result.difference, recordedAmount: result.recordedAmount });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}
// Issues the deposit-difference refund for a plan downgrade directly
// through Razorpay, against the customer's original deposit payment —
// instead of the admin having to pay them some other way and upload proof.
// Only records the Razorpay refund id here; the actual receipt is created
// once "Confirm & Apply Plan Change" runs (see changePlan above), so this
// alone doesn't change the customer's plan yet.
async function refundPlanChangeViaRazorpay(req, res) {
    try {
        const amount = Number(req.body.amount);
        if (!amount || amount <= 0) {
            return res.status(400).json({ success: false, message: "A valid amount is required" });
        }
        const customer = await prisma_1.prisma.customer.findUnique({ where: { id: req.params.id } });
        if (!customer) {
            return res.status(404).json({ success: false, message: "Customer not found" });
        }
        // Exclusivity check: reject Razorpay refund if manual proof exists
        if (customer.planChangeRefundProofUrl) {
            return res.status(400).json({
                success: false,
                message: "Cannot refund via Razorpay because a manual refund proof has already been uploaded."
            });
        }
        // Idempotency check: if Razorpay refund was already created/initiated, return it
        if (customer.planChangeRazorpayRefundId) {
            try {
                const existingRefund = await razorpay_1.razorpay.refunds.fetch(customer.planChangeRazorpayRefundId);
                return res.json({ success: true, customer, refund: existingRefund });
            }
            catch {
                return res.json({
                    success: true,
                    customer,
                    refund: { id: customer.planChangeRazorpayRefundId, status: "processed" }
                });
            }
        }
        const refund = await (0, refund_service_1.refundPlanChangeDeposit)(customer.id, amount);
        const updated = await prisma_1.prisma.customer.update({
            where: { id: customer.id },
            data: { planChangeRazorpayRefundId: refund.id }
        });
        res.json({ success: true, customer: updated, refund });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.error?.description || error.message });
    }
}
async function requestRefundOtp(req, res) {
    try {
        const customerId = req.params.id;
        const customer = await prisma_1.prisma.customer.findUnique({ where: { id: customerId } });
        if (!customer) {
            return res.status(404).json({ success: false, message: "Customer not found" });
        }
        // Exclusivity: reject if manual refund proof has been uploaded
        if (customer.planChangeRefundProofUrl) {
            return res.status(400).json({
                success: false,
                message: "Cannot refund via Razorpay because a manual refund proof has already been uploaded."
            });
        }
        // Check existing status
        if (customer.planChangeRefundStatus === "REFUND_SUCCESS" || customer.planChangeRazorpayRefundId) {
            return res.status(400).json({
                success: false,
                message: "Refund has already been successfully processed."
            });
        }
        if (customer.planChangeRefundStatus === "REFUND_PROCESSING") {
            return res.status(400).json({
                success: false,
                message: "A refund is currently processing for this customer."
            });
        }
        // Calculate required refund amount (original plan deposit - new plan deposit)
        const newPlanDuration = Number(req.body.newPlanDuration);
        if (newPlanDuration !== 12 && newPlanDuration !== 24) {
            return res.status(400).json({ success: false, message: "Plan must be 12 or 24 months" });
        }
        const difference = (0, planPricing_1.securityDepositAmount)(newPlanDuration) - (0, planPricing_1.securityDepositAmount)(customer.planDuration);
        if (difference >= 0) {
            return res.status(400).json({ success: false, message: "This operation is only for plan downgrades (refunds)." });
        }
        const refundAmount = Math.abs(difference);
        // Call Twilio Verify API to send OTP
        const verification = await twilio_1.twilioClient.verify.v2
            .services(env_1.env.twilio.verifyServiceSid)
            .verifications.create({
            to: env_1.env.admin.mobile,
            channel: "sms",
        });
        // Save status and calculated amount in the database
        const updated = await prisma_1.prisma.customer.update({
            where: { id: customer.id },
            data: {
                planChangeRefundStatus: "OTP_PENDING",
                planChangeRefundAmount: refundAmount,
            }
        });
        // Derive masked mobile number from env.admin.mobile (e.g. "••••3210")
        const rawMobile = env_1.env.admin.mobile;
        const maskedMobile = `••••${rawMobile.slice(-4)}`;
        res.json({
            success: true,
            maskedMobile,
            expiresIn: 300,
            customer: updated
        });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}
async function verifyRefundOtpAndExecute(req, res) {
    try {
        const customerId = req.params.id;
        const { code } = req.body;
        if (!code) {
            return res.status(400).json({ success: false, message: "OTP code is required" });
        }
        // Twilio Verification Check
        const verificationCheck = await twilio_1.twilioClient.verify.v2
            .services(env_1.env.twilio.verifyServiceSid)
            .verificationChecks.create({
            to: env_1.env.admin.mobile,
            code,
        });
        if (verificationCheck.status !== "approved") {
            return res.status(400).json({
                success: false,
                message: "Invalid verification code. Please try again."
            });
        }
        // Re-fetch customer
        const customer = await prisma_1.prisma.customer.findUnique({ where: { id: customerId } });
        if (!customer) {
            return res.status(404).json({ success: false, message: "Customer not found" });
        }
        // Check database state hasn't changed
        if (customer.planChangeRefundStatus !== "OTP_PENDING") {
            return res.status(400).json({
                success: false,
                message: "Invalid or expired OTP context."
            });
        }
        if (!customer.planChangeRefundAmount || customer.planChangeRefundAmount <= 0) {
            return res.status(400).json({
                success: false,
                message: "No valid refund amount has been calculated."
            });
        }
        // Exclusivity: reject if manual refund proof has been uploaded
        if (customer.planChangeRefundProofUrl) {
            return res.status(400).json({
                success: false,
                message: "Cannot refund via Razorpay because a manual refund proof has already been uploaded."
            });
        }
        // Set state to REFUND_PROCESSING to lock concurrent updates
        let updated = await prisma_1.prisma.customer.update({
            where: { id: customer.id },
            data: { planChangeRefundStatus: "REFUND_PROCESSING" }
        });
        try {
            // Execute Razorpay refund
            const refund = await (0, refund_service_1.refundPlanChangeDeposit)(customer.id, customer.planChangeRefundAmount);
            // Set state to REFUND_SUCCESS
            updated = await prisma_1.prisma.customer.update({
                where: { id: customer.id },
                data: {
                    planChangeRefundStatus: "REFUND_SUCCESS",
                    planChangeRazorpayRefundId: refund.id
                }
            });
            res.json({ success: true, customer: updated, refund });
        }
        catch (refundError) {
            // If refund failed, revert to REFUND_FAILED
            updated = await prisma_1.prisma.customer.update({
                where: { id: customer.id },
                data: { planChangeRefundStatus: "REFUND_FAILED" }
            });
            res.status(500).json({
                success: false,
                message: refundError.error?.description || refundError.message,
                customer: updated
            });
        }
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}
async function cancelRefundOtp(req, res) {
    try {
        const customerId = req.params.id;
        const customer = await prisma_1.prisma.customer.findUnique({ where: { id: customerId } });
        if (!customer) {
            return res.status(404).json({ success: false, message: "Customer not found" });
        }
        if (customer.planChangeRefundStatus === "REFUND_PROCESSING" || customer.planChangeRefundStatus === "REFUND_SUCCESS") {
            return res.status(400).json({ success: false, message: "Cannot cancel a refund that is processing or succeeded." });
        }
        const updated = await prisma_1.prisma.customer.update({
            where: { id: customer.id },
            data: {
                planChangeRefundStatus: "NOT_STARTED",
                planChangeRefundAmount: null
            }
        });
        res.json({ success: true, customer: updated });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}
// A UPI VPA is "<handle>@<psp bank/app name>" — e.g. name@okhdfcbank, 9999999999@ybl.
const VPA_PATTERN = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;
async function requestPayoutOtp(req, res) {
    try {
        const customerId = req.params.id;
        const amountPaise = Number(req.body.amountPaise);
        const { reason } = req.body;
        // "bank" (default, backward-compatible) pays into the customer's saved
        // bank details; "upi" pays a UPI ID the admin types in for this payout,
        // so a payment doesn't have to wait on the customer submitting bank
        // details first.
        const payoutMethod = req.body.payoutMethod === "upi" ? "upi" : "bank";
        if (!amountPaise || amountPaise <= 0) {
            return res.status(400).json({ success: false, message: "Valid amount in paise is required" });
        }
        if (!reason) {
            return res.status(400).json({ success: false, message: "Reason is required" });
        }
        const customer = await prisma_1.prisma.customer.findUnique({ where: { id: customerId } });
        if (!customer) {
            return res.status(404).json({ success: false, message: "Customer not found" });
        }
        let recipientNameSnapshot;
        let recipientIdentifierSnapshot;
        let payoutDestinationType;
        let payoutVpa = null;
        if (payoutMethod === "upi") {
            const upiId = typeof req.body.upiId === "string" ? req.body.upiId.trim() : "";
            if (!VPA_PATTERN.test(upiId)) {
                return res.status(400).json({ success: false, message: "Enter a valid UPI ID (e.g. name@bank)" });
            }
            payoutDestinationType = "VPA";
            payoutVpa = upiId;
            recipientNameSnapshot = customer.fullName;
            recipientIdentifierSnapshot = upiId;
        }
        else {
            // Verify recipient details are present
            const bankAccountNumber = customer.bankAccountNumber || customer.refundBankAccountNumber;
            const bankIfscCode = customer.bankIfscCode || customer.refundBankIfscCode;
            const bankAccountHolderName = customer.bankAccountHolderName || customer.refundBankAccountHolderName;
            if (!bankAccountNumber || !bankIfscCode || !bankAccountHolderName) {
                return res.status(400).json({
                    success: false,
                    message: "Customer bank account details (account number, IFSC, name) must be saved first."
                });
            }
            // Mask bank account number for safety snapshot
            const maskedAccount = `••••${bankAccountNumber.slice(-4)}`;
            payoutDestinationType = "BANK_ACCOUNT";
            recipientNameSnapshot = bankAccountHolderName;
            recipientIdentifierSnapshot = `${customer.bankName || customer.refundBankName || "Bank"} (${maskedAccount})`;
        }
        // Generate unique idempotency key
        const idempotencyKey = crypto.randomUUID();
        // Call Twilio Verify API to send OTP
        const verification = await twilio_1.twilioClient.verify.v2
            .services(env_1.env.twilio.verifyServiceSid)
            .verifications.create({
            to: env_1.env.admin.mobile,
            channel: "sms",
        });
        // Create MoneyTransaction record in DRAFT/OTP_PENDING status
        const otpChallengeId = verification.sid;
        const otpExpiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
        const transaction = await prisma_1.prisma.moneyTransaction.create({
            data: {
                customerId: customer.id,
                direction: "PAY_TO_CUSTOMER",
                amountPaise,
                reason,
                method: "RAZORPAY_PAYOUT",
                status: "OTP_PENDING",
                recipientNameSnapshot,
                recipientIdentifierSnapshot,
                payoutDestinationType,
                payoutVpa,
                idempotencyKey,
                otpChallengeId,
                otpExpiresAt,
                createdBy: env_1.env.admin.email,
            }
        });
        const rawMobile = env_1.env.admin.mobile;
        const maskedMobile = `••••${rawMobile.slice(-4)}`;
        res.json({
            success: true,
            transactionId: transaction.id,
            maskedMobile,
            expiresIn: 300,
        });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}
async function verifyPayoutOtpAndExecute(req, res) {
    try {
        const { transactionId, code } = req.body;
        if (!transactionId || !code) {
            return res.status(400).json({ success: false, message: "Transaction ID and OTP code are required" });
        }
        // Fetch the transaction
        const transaction = await prisma_1.prisma.moneyTransaction.findUnique({
            where: { id: transactionId },
            include: { customer: true }
        });
        if (!transaction) {
            return res.status(404).json({ success: false, message: "Transaction not found" });
        }
        if (!env_1.env.razorpay.accountNumberX) {
            return res.status(503).json({ success: false, message: "RazorpayX payouts are not configured on this server" });
        }
        if (transaction.status !== "OTP_PENDING") {
            return res.status(400).json({ success: false, message: "Transaction is not in OTP_PENDING status" });
        }
        if (transaction.otpExpiresAt && transaction.otpExpiresAt < new Date()) {
            return res.status(400).json({ success: false, message: "OTP has expired" });
        }
        // Verify OTP via Twilio
        const verificationCheck = await twilio_1.twilioClient.verify.v2
            .services(env_1.env.twilio.verifyServiceSid)
            .verificationChecks.create({
            to: env_1.env.admin.mobile,
            code,
        });
        if (verificationCheck.status !== "approved") {
            await prisma_1.prisma.moneyTransaction.update({
                where: { id: transactionId },
                data: { otpAttempts: { increment: 1 } }
            });
            return res.status(400).json({ success: false, message: "Invalid OTP code" });
        }
        // Transition state to PROCESSING to lock transaction
        await prisma_1.prisma.moneyTransaction.update({
            where: { id: transactionId },
            data: { status: "PROCESSING" }
        });
        const customer = transaction.customer;
        let contactId = customer.razorpayXContactId;
        let fundAccountId = customer.razorpayXFundAccountId;
        const basicAuth = Buffer.from(`${env_1.env.razorpay.keyId}:${env_1.env.razorpay.keySecret}`).toString("base64");
        // 1. Create contact if not exists
        if (!contactId) {
            const contactRes = await fetch("https://api.razorpay.com/v1/contacts", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Basic ${basicAuth}`
                },
                body: JSON.stringify({
                    name: customer.fullName,
                    email: customer.email,
                    contact: customer.mobileNumber,
                    type: "customer",
                    reference_id: customer.id
                })
            });
            const contactData = await contactRes.json();
            if (!contactRes.ok) {
                throw new Error(contactData.error?.description || "Failed to create RazorpayX Contact");
            }
            contactId = contactData.id;
            await prisma_1.prisma.customer.update({
                where: { id: customer.id },
                data: { razorpayXContactId: contactId }
            });
        }
        // 2. Create fund account if not exists.
        // UPI payouts always create a fresh fund account for the VPA the admin
        // typed in for this specific transaction — it isn't cached on the
        // customer, since (unlike bank details) it isn't a stored profile field
        // and could be different on the next payout.
        if (transaction.payoutDestinationType === "VPA" && transaction.payoutVpa) {
            const faRes = await fetch("https://api.razorpay.com/v1/fund_accounts", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Basic ${basicAuth}`
                },
                body: JSON.stringify({
                    contact_id: contactId,
                    account_type: "vpa",
                    vpa: { address: transaction.payoutVpa }
                })
            });
            const faData = await faRes.json();
            if (!faRes.ok) {
                throw new Error(faData.error?.description || "Failed to create RazorpayX Fund Account");
            }
            fundAccountId = faData.id;
        }
        else if (!fundAccountId) {
            const bankAccountNumber = customer.bankAccountNumber || customer.refundBankAccountNumber;
            const bankIfscCode = customer.bankIfscCode || customer.refundBankIfscCode;
            const bankAccountHolderName = customer.bankAccountHolderName || customer.refundBankAccountHolderName;
            const faRes = await fetch("https://api.razorpay.com/v1/fund_accounts", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Basic ${basicAuth}`
                },
                body: JSON.stringify({
                    contact_id: contactId,
                    account_type: "bank_account",
                    bank_account: {
                        name: bankAccountHolderName,
                        ifsc: bankIfscCode,
                        account_number: bankAccountNumber
                    }
                })
            });
            const faData = await faRes.json();
            if (!faRes.ok) {
                throw new Error(faData.error?.description || "Failed to create RazorpayX Fund Account");
            }
            fundAccountId = faData.id;
            await prisma_1.prisma.customer.update({
                where: { id: customer.id },
                data: { razorpayXFundAccountId: fundAccountId }
            });
        }
        // 3. Create payout
        const payoutRes = await fetch("https://api.razorpay.com/v1/payouts", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Basic ${basicAuth}`,
                "X-Payout-Idempotency": transaction.idempotencyKey
            },
            body: JSON.stringify({
                account_number: env_1.env.razorpay.accountNumberX,
                fund_account_id: fundAccountId,
                amount: transaction.amountPaise,
                currency: "INR",
                // Razorpay requires the payout mode to match the fund account type —
                // UPI for a vpa fund account, IMPS for a bank_account one.
                mode: transaction.payoutDestinationType === "VPA" ? "UPI" : "IMPS",
                purpose: "refund",
                narration: transaction.reason.substring(0, 30),
                reference_id: transaction.id
            })
        });
        const payoutData = await payoutRes.json();
        if (!payoutRes.ok) {
            const updatedTx = await prisma_1.prisma.moneyTransaction.update({
                where: { id: transactionId },
                data: {
                    status: "FAILED",
                    razorpayStatusReason: payoutData.error?.description || "Payout creation failed",
                }
            });
            return res.status(400).json({
                success: false,
                message: payoutData.error?.description || "Failed to create RazorpayX Payout",
                transaction: updatedTx
            });
        }
        let initialStatus = "PROCESSING";
        const rpStatus = payoutData.status;
        if (rpStatus === "queued") {
            initialStatus = "QUEUED";
        }
        else if (rpStatus === "pending") {
            initialStatus = "PENDING";
        }
        else if (rpStatus === "rejected") {
            initialStatus = "REJECTED";
        }
        else if (rpStatus === "processed") {
            initialStatus = "SUCCESS";
        }
        else if (rpStatus === "reversed") {
            initialStatus = "REVERSED";
        }
        else if (rpStatus === "failed") {
            initialStatus = "FAILED";
        }
        const finalTx = await prisma_1.prisma.moneyTransaction.update({
            where: { id: transactionId },
            data: {
                status: initialStatus,
                razorpayPayoutId: payoutData.id,
                razorpayPayoutStatus: rpStatus,
                razorpayUtr: payoutData.utr || null,
                razorpayStatusReason: payoutData.status_details?.reason || null,
                razorpayStatusDescription: payoutData.status_details?.description || null,
            }
        });
        res.json({ success: true, transaction: finalTx });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}
async function cancelPayout(req, res) {
    try {
        const { transactionId } = req.body;
        if (!transactionId) {
            return res.status(400).json({ success: false, message: "Transaction ID is required" });
        }
        const transaction = await prisma_1.prisma.moneyTransaction.findUnique({
            where: { id: transactionId }
        });
        if (!transaction) {
            return res.status(404).json({ success: false, message: "Transaction not found" });
        }
        if (transaction.status !== "DRAFT" && transaction.status !== "OTP_PENDING") {
            return res.status(400).json({ success: false, message: "Cannot cancel transaction in current status." });
        }
        const updated = await prisma_1.prisma.moneyTransaction.update({
            where: { id: transactionId },
            data: { status: "CANCELLED" }
        });
        res.json({ success: true, transaction: updated });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}
async function getCustomerMoneyTransactions(req, res) {
    try {
        const customerId = req.params.id;
        const transactions = await prisma_1.prisma.moneyTransaction.findMany({
            where: { customerId },
            orderBy: { createdAt: "desc" }
        });
        res.json({ success: true, transactions });
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