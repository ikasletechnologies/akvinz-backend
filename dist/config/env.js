"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
function required(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}
// For config that only backs one optional feature (e.g. a specific payment
// integration) rather than the app as a whole — missing it shouldn't crash
// the server, just disable that feature. Warn once at boot so it's visible
// in logs, and let the feature fail with a clear error at the point of use.
function optional(name) {
    const value = process.env[name];
    if (!value) {
        console.warn(`[env] ${name} not set — features depending on it will be disabled`);
    }
    return value;
}
exports.env = {
    nodeEnv: process.env.NODE_ENV || "development",
    port: process.env.PORT || 5000,
    databaseUrl: required("DATABASE_URL"),
    uploadDir: required("UPLOAD_DIR"),
    baseUrl: required("BASE_URL"),
    corsOrigin: process.env.CORS_ORIGIN || "*",
    twilio: {
        accountSid: required("TWILIO_ACCOUNT_SID"),
        authToken: required("TWILIO_AUTH_TOKEN"),
        verifyServiceSid: required("TWILIO_VERIFY_SERVICE_SID"),
    },
    razorpay: {
        keyId: required("RAZORPAY_KEY_ID"),
        keySecret: required("RAZORPAY_KEY_SECRET"),
        // Normal Razorpay Payment/Refund webhook
        webhookSecret: required("RAZORPAY_WEBHOOK_SECRET"),
        // RazorpayX Payout webhook — separate secret, optional until RazorpayX is activated
        webhookSecretX: optional("RAZORPAYX_PAYOUT_WEBHOOK_SECRET"),
        // RazorpayX account number — optional until RazorpayX is activated
        accountNumberX: optional("RAZORPAYX_ACCOUNT_NUMBER"),
    },
    admin: {
        email: required("ADMIN_EMAIL"),
        password: required("ADMIN_PASSWORD"),
        jwtSecret: required("ADMIN_JWT_SECRET"),
        mobile: required("ADMIN_MOBILE"),
    },
};
//# sourceMappingURL=env.js.map