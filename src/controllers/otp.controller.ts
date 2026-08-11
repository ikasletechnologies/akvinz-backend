import { Request, Response } from "express";
import { twilioClient } from "../config/twilio";
import { env } from "../config/env";

export async function sendOtp(
  req: Request,
  res: Response
): Promise<any> {
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
    console.log("Verify Service:", env.twilio.verifyServiceSid);
    console.log("Account SID:", env.twilio.accountSid);

    const verification = await twilioClient.verify.v2
      .services(env.twilio.verifyServiceSid)
      .verifications.create({
        to: mobileNumber,
        channel: "sms",
      });

    console.log("✅ Twilio OTP response:", verification.status);

    return res.json({
      success: true,
      status: verification.status,
    });
  } catch (error: any) {
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

export async function verifyOtp(
  req: Request,
  res: Response
): Promise<any> {
  const { mobileNumber, code } = req.body;

  if (!mobileNumber || !code) {
    return res.status(400).json({
      success: false,
      message: "mobileNumber and code are required",
    });
  }

  try {
    const verificationCheck = await twilioClient.verify.v2
      .services(env.twilio.verifyServiceSid)
      .verificationChecks.create({
        to: mobileNumber,
        code,
      });

    console.log(
      "OTP verification status:",
      verificationCheck.status
    );

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
  } catch (error: any) {
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
