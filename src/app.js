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
        res.status(500).json({ success: false, error: error.message });
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
exports.default = app;
//# sourceMappingURL=app.js.map