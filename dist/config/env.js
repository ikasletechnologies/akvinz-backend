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
exports.env = {
    port: process.env.PORT || 5000,
    databaseUrl: required("DATABASE_URL"),
    uploadDir: required("UPLOAD_DIR"),
    baseUrl: required("BASE_URL"),
    twilio: {
        accountSid: required("TWILIO_ACCOUNT_SID"),
        authToken: required("TWILIO_AUTH_TOKEN"),
        verifyServiceSid: required("TWILIO_VERIFY_SERVICE_SID"),
    },
    razorpay: {
        keyId: required("RAZORPAY_KEY_ID"),
        keySecret: required("RAZORPAY_KEY_SECRET"),
        webhookSecret: required("RAZORPAY_WEBHOOK_SECRET"),
    },
    admin: {
        email: required("ADMIN_EMAIL"),
        password: required("ADMIN_PASSWORD"),
        jwtSecret: required("ADMIN_JWT_SECRET"),
    },
};
//# sourceMappingURL=env.js.map