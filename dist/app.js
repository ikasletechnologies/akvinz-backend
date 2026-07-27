"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const compression_1 = __importDefault(require("compression"));
const morgan_1 = __importDefault(require("morgan"));
const twilio_1 = __importDefault(require("twilio"));
const dotenv_1 = __importDefault(require("dotenv"));
const razorpay_1 = __importDefault(require("razorpay"));
const crypto_1 = __importDefault(require("crypto"));
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const prisma_1 = require("./generated/prisma");
dotenv_1.default.config();
const pool = new pg_1.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new prisma_1.PrismaClient({ adapter });
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use((0, helmet_1.default)());
app.use((0, compression_1.default)());
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
app.use((0, morgan_1.default)("dev"));
app.use("/uploads", express_1.default.static("uploads"));
const twilioClient = (0, twilio_1.default)(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
app.post("/api/send-otp", async (req, res) => {
    const { mobileNumber } = req.body;
    if (!mobileNumber) {
        return res.status(400).json({ success: false, message: "mobileNumber is required" });
    }
    try {
        const verification = await twilioClient.verify.v2.services(process.env.TWILIO_VERIFY_SERVICE_SID)
            .verifications.create({ to: mobileNumber, channel: "sms" });
        res.json({ success: true, status: verification.status });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
app.post("/api/verify-otp", async (req, res) => {
    const { mobileNumber, code } = req.body;
    if (!mobileNumber || !code) {
        return res.status(400).json({ success: false, message: "mobileNumber and code are required" });
    }
    try {
        const verificationCheck = await twilioClient.verify.v2.services(process.env.TWILIO_VERIFY_SERVICE_SID)
            .verificationChecks.create({ to: mobileNumber, code });
        if (verificationCheck.status === "approved") {
            res.json({ success: true, verified: true });
        }
        else {
            res.status(400).json({ success: false, verified: false, message: "Invalid OTP" });
        }
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// Multer setup
const storage = multer_1.default.diskStorage({
    destination: function (req, file, cb) {
        cb(null, "uploads/");
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, file.fieldname + "-" + uniqueSuffix + path_1.default.extname(file.originalname));
    }
});
const upload = (0, multer_1.default)({ storage: storage });
app.post("/api/register", upload.fields([
    { name: "aadharFile", maxCount: 1 },
    { name: "panFile", maxCount: 1 },
    { name: "residenceFile", maxCount: 1 }
]), async (req, res) => {
    try {
        const { fullName, mobileNumber, email, addressLine1, addressLine2, city, state, pincode, planDuration, houseType } = req.body;
        const files = req.files;
        const customer = await prisma.customer.create({
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
                aadharImageUrl: files["aadharFile"]?.[0]?.filename || null,
                panImageUrl: files["panFile"]?.[0]?.filename || null,
                residenceDocUrl: files["residenceFile"]?.[0]?.filename || null,
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
});
const razorpay = new razorpay_1.default({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});
app.post("/api/create-order", async (req, res) => {
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
        const order = await razorpay.orders.create(options);
        res.json({ success: true, order });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
app.post("/api/verify-payment", async (req, res) => {
    try {
        const { customerId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
        const sign = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSign = crypto_1.default
            .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
            .update(sign.toString())
            .digest("hex");
        if (razorpay_signature === expectedSign) {
            if (customerId) {
                await prisma.customer.update({
                    where: { id: customerId },
                    data: {
                        paymentStatus: "COMPLETED",
                        razorpayOrderId: razorpay_order_id,
                        razorpayPaymentId: razorpay_payment_id
                    }
                });
            }
            return res.json({ success: true, message: "Payment verified successfully" });
        }
        else {
            if (customerId) {
                await prisma.customer.update({
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
});
app.get("/api/customer/:mobileNumber", async (req, res) => {
    try {
        const { mobileNumber } = req.params;
        const mobileWithoutCode = mobileNumber.replace(/^\+91/, "");
        const customer = await prisma.customer.findFirst({
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
});
app.post("/api/verify-rental-payment", async (req, res) => {
    try {
        const { customerId, rentalPlanDuration, rentalAmount, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
        const sign = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSign = crypto_1.default
            .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
            .update(sign.toString())
            .digest("hex");
        if (razorpay_signature === expectedSign) {
            if (customerId) {
                const customer = await prisma.customer.findUnique({ where: { id: customerId } });
                let newStart = new Date();
                let newEnd = new Date();
                newEnd.setDate(newEnd.getDate() + 30); // 30 days from payment
                await prisma.customer.update({
                    where: { id: customerId },
                    data: {
                        rentalPlanDuration,
                        rentalAmount,
                        subscriptionStatus: "ACTIVE",
                        subscriptionStart: newStart,
                        subscriptionEnd: newEnd,
                        lastPaymentDate: newStart,
                        razorpayOrderId: razorpay_order_id,
                        razorpayPaymentId: razorpay_payment_id
                    }
                });
            }
            return res.json({ success: true, message: "Rental Payment verified successfully" });
        }
        else {
            return res.status(400).json({ success: false, message: "Invalid signature sent!" });
        }
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
app.post("/api/subscription/return", async (req, res) => {
    try {
        const { customerId } = req.body;
        if (!customerId) {
            return res.status(400).json({ success: false, message: "customerId is required" });
        }
        const customer = await prisma.customer.findUnique({ where: { id: customerId } });
        if (!customer) {
            return res.status(404).json({ success: false, message: "Customer not found" });
        }
        if (customer.subscriptionStatus !== "ACTIVE") {
            return res.status(400).json({ success: false, message: "No active subscription to discontinue" });
        }
        const updated = await prisma.customer.update({
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
});
// Final step of the close-agreement flow: only usable once the admin has inspected the
// returned product and fixed a refundAmount. The customer just confirms that fixed number.
app.post("/api/account/close", async (req, res) => {
    try {
        const { customerId } = req.body;
        if (!customerId) {
            return res.status(400).json({ success: false, message: "customerId is required" });
        }
        const customer = await prisma.customer.findUnique({ where: { id: customerId } });
        if (!customer) {
            return res.status(404).json({ success: false, message: "Customer not found" });
        }
        if (customer.paymentStatus !== "PENDING_REFUND") {
            return res.status(400).json({ success: false, message: "No pending refund found for this account" });
        }
        if (customer.refundAmount === null) {
            return res.status(400).json({ success: false, message: "Refund amount has not been finalized yet" });
        }
        const updated = await prisma.customer.update({
            where: { id: customerId },
            data: { paymentStatus: "REFUNDED" }
        });
        res.json({ success: true, customer: updated });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
// ============ Admin Panel ============
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET;
function requireAdmin(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    try {
        jsonwebtoken_1.default.verify(token, ADMIN_JWT_SECRET);
        next();
    }
    catch (error) {
        return res.status(401).json({ success: false, message: "Invalid or expired token" });
    }
}
app.post("/api/admin/login", (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ success: false, message: "Email and password are required" });
    }
    if (email !== process.env.ADMIN_EMAIL || password !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({ success: false, message: "Invalid credentials" });
    }
    const token = jsonwebtoken_1.default.sign({ email, role: "admin" }, ADMIN_JWT_SECRET, { expiresIn: "12h" });
    res.json({ success: true, token });
});
app.get("/api/admin/stats", requireAdmin, async (req, res) => {
    try {
        const [totalCustomers, activeSubscriptions, pendingPayments, completedPayments, totalReturns, pendingRefunds, revenueAgg] = await Promise.all([
            prisma.customer.count(),
            prisma.customer.count({ where: { subscriptionStatus: "ACTIVE" } }),
            prisma.customer.count({ where: { paymentStatus: "PENDING" } }),
            prisma.customer.count({ where: { paymentStatus: "COMPLETED" } }),
            prisma.customer.count({ where: { returnRequested: true } }),
            prisma.customer.count({ where: { paymentStatus: "PENDING_REFUND" } }),
            prisma.customer.aggregate({ _sum: { rentalAmount: true } })
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
});
app.get("/api/admin/customers", requireAdmin, async (req, res) => {
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
            prisma.customer.findMany({
                where,
                orderBy: { createdAt: "desc" },
                skip: (pageNum - 1) * limitNum,
                take: limitNum
            }),
            prisma.customer.count({ where })
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
});
app.get("/api/admin/customers/:id", requireAdmin, async (req, res) => {
    try {
        const customer = await prisma.customer.findUnique({ where: { id: req.params.id } });
        if (!customer) {
            return res.status(404).json({ success: false, message: "Customer not found" });
        }
        res.json({ success: true, customer });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
app.patch("/api/admin/customers/:id", requireAdmin, async (req, res) => {
    try {
        const allowedFields = [
            "fullName", "mobileNumber", "email", "addressLine1", "addressLine2",
            "city", "state", "pincode", "planDuration", "houseType",
            "paymentStatus", "rentalPlanDuration", "rentalAmount",
            "subscriptionStatus", "subscriptionStart", "subscriptionEnd",
            "returnRequested", "refundAmount"
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
        if (data.refundAmount !== undefined)
            data.refundAmount = data.refundAmount === "" ? null : parseInt(data.refundAmount);
        if (data.returnRequested !== undefined)
            data.returnRequested = data.returnRequested === true || data.returnRequested === "true";
        const customer = await prisma.customer.update({
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
});
app.delete("/api/admin/customers/:id", requireAdmin, async (req, res) => {
    try {
        await prisma.customer.delete({ where: { id: req.params.id } });
        res.json({ success: true, message: "Customer deleted" });
    }
    catch (error) {
        if (error.code === "P2025") {
            return res.status(404).json({ success: false, message: "Customer not found" });
        }
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.default = app;
//# sourceMappingURL=app.js.map