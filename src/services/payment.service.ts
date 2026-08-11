import crypto from "crypto";
import { env } from "../config/env";

export function verifyRazorpaySignature(orderId: string, paymentId: string, signature: string): boolean {
  const expectedSignature = crypto
    .createHmac("sha256", env.razorpay.keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  return signature === expectedSignature;
}
