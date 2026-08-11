"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyRazorpaySignature = verifyRazorpaySignature;
const crypto_1 = __importDefault(require("crypto"));
const env_1 = require("../config/env");
function verifyRazorpaySignature(orderId, paymentId, signature) {
    const expectedSignature = crypto_1.default
        .createHmac("sha256", env_1.env.razorpay.keySecret)
        .update(`${orderId}|${paymentId}`)
        .digest("hex");
    return signature === expectedSignature;
}
//# sourceMappingURL=payment.service.js.map