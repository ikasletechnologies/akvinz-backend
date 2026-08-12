import { Request, Response } from "express";
import crypto from "crypto";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { markPaymentLinkPaid } from "../services/paymentLink.service";

// Razorpay calls this with the raw request body (see app.ts, which mounts
// this route with express.raw() ahead of the global express.json()) so the
// HMAC signature can be verified against the exact bytes Razorpay signed.
export async function razorpayWebhook(req: Request, res: Response): Promise<any> {
  const signature = req.headers["x-razorpay-signature"] as string | undefined;
  const rawBody = req.body as Buffer;

  if (!signature) {
    return res.status(400).json({ success: false, message: "Missing signature" });
  }

  const expectedSignature = crypto
    .createHmac("sha256", env.razorpay.webhookSecret)
    .update(rawBody)
    .digest("hex");

  if (signature !== expectedSignature) {
    return res.status(400).json({ success: false, message: "Invalid signature" });
  }

  const payload = JSON.parse(rawBody.toString("utf8"));

  if (payload.event === "payment_link.paid") {
    const linkEntity = payload.payload?.payment_link?.entity;
    const paymentEntity = payload.payload?.payment?.entity;

    if (linkEntity?.id) {
      const record = await prisma.paymentLinkRequest.findUnique({
        where: { razorpayPaymentLinkId: linkEntity.id }
      });

      if (record) {
        await markPaymentLinkPaid(record.id, paymentEntity?.id ?? null);
      }
    }
  }

  res.json({ success: true });
}
