import crypto from "crypto";
import { env } from "../config/env";

export function verifyRazorpaySignature(orderId: string, paymentId: string, signature: string): boolean {
  const expectedSignature = crypto
    .createHmac("sha256", env.razorpay.keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  return signature === expectedSignature;
}

// Subscription (autopay mandate) checkout uses a different signature formula
// than one-time orders: paymentId|subscriptionId instead of orderId|paymentId.
export function verifyRazorpaySubscriptionSignature(subscriptionId: string, paymentId: string, signature: string): boolean {
  const expectedSignature = crypto
    .createHmac("sha256", env.razorpay.keySecret)
    .update(`${paymentId}|${subscriptionId}`)
    .digest("hex");

  return signature === expectedSignature;
}
