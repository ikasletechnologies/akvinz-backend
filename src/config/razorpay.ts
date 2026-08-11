import Razorpay from "razorpay";
import { env } from "./env";

export const razorpay = new Razorpay({
  key_id: env.razorpay.keyId,
  key_secret: env.razorpay.keySecret,
});
