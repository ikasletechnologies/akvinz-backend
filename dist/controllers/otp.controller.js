"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendOtp = sendOtp;
exports.verifyOtp = verifyOtp;
const twilio_1 = require("../config/twilio");
const env_1 = require("../config/env");
async function sendOtp(req, res) {
    const { mobileNumber } = req.body;
    if (!mobileNumber) {
        return res.status(400).json({
            success: false,
            message: "mobileNumber is required",
        });
    }
    try {
        console.log("📱 Sending OTP");
        console.log("To:", mobileNumber);
        console.log("Verify Service:", env_1.env.twilio.verifyServiceSid);
        console.log("Account SID:", env_1.env.twilio.accountSid);
        const verification = await twilio_1.twilioClient.verify.v2
            .services(env_1.env.twilio.verifyServiceSid)
            .verifications.create({
            to: mobileNumber,
            channel: "sms",
        });
        console.log("✅ Twilio OTP response:", verification.status);
        return res.json({
            success: true,
            status: verification.status,
        });
    }
    catch (error) {
        console.error("❌ Twilio OTP ERROR");
        console.error("Message:", error?.message);
        console.error("Code:", error?.code);
        console.error("Status:", error?.status);
        console.error("More info:", error?.moreInfo);
        return res.status(500).json({
            success: false,
            message: "Failed to send OTP",
            error: error?.message,
            code: error?.code,
            twilioStatus: error?.status,
        });
    }
}
async function verifyOtp(req, res) {
    const { mobileNumber, code } = req.body;
    if (!mobileNumber || !code) {
        return res.status(400).json({
            success: false,
            message: "mobileNumber and code are required",
        });
    }
    try {
        const verificationCheck = await twilio_1.twilioClient.verify.v2
            .services(env_1.env.twilio.verifyServiceSid)
            .verificationChecks.create({
            to: mobileNumber,
            code,
        });
        console.log("OTP verification status:", verificationCheck.status);
        if (verificationCheck.status === "approved") {
            return res.json({
                success: true,
                verified: true,
            });
        }
        return res.status(400).json({
            success: false,
            verified: false,
            message: "Invalid OTP",
        });
    }
    catch (error) {
        console.error("❌ Twilio Verify OTP ERROR");
        console.error("Message:", error?.message);
        console.error("Code:", error?.code);
        console.error("Status:", error?.status);
        return res.status(500).json({
            success: false,
            message: "OTP verification failed",
            error: error?.message,
            code: error?.code,
        });
    }
}
//# sourceMappingURL=otp.controller.js.map