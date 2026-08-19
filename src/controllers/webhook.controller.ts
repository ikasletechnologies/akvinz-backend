import { Request, Response } from "express";
import crypto from "crypto";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { markPaymentLinkPaid } from "../services/paymentLink.service";
import { finalizeRegistration } from "../services/registration.service";
import { activateRentalCycle } from "../services/autopay.service";

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

  // Registration security deposit — server-to-server confirmation that a
  // draft's order was paid, independent of whether the customer's browser
  // stays connected long enough to call /verify-payment itself. Requires
  // draftId to have been attached to the order's notes at creation time
  // (customerForm.tsx's handlePayment -> /create-order).
  if (payload.event === "order.paid") {
    const orderEntity = payload.payload?.order?.entity;
    const paymentEntity = payload.payload?.payment?.entity;
    const draftId = orderEntity?.notes?.draftId;

    if (draftId && orderEntity?.id && paymentEntity?.id) {
      await finalizeRegistration(draftId, orderEntity.id, paymentEntity.id);
    }
  }

  // Rental autopay (UPI Autopay / e-mandate) lifecycle — see autopay.service.ts
  // for how the subscription is first created and authorized.
  if (payload.event === "subscription.activated") {
    const subEntity = payload.payload?.subscription?.entity;
    if (subEntity?.id) {
      await prisma.customer.updateMany({
        where: { razorpaySubscriptionId: subEntity.id },
        data: { autopayStatus: "ACTIVE" }
      });
    }
  }

  if (payload.event === "subscription.charged") {
    const subEntity = payload.payload?.subscription?.entity;
    const paymentEntity = payload.payload?.payment?.entity;

    if (subEntity?.id && paymentEntity?.id) {
      const customer = await prisma.customer.findUnique({
        where: { razorpaySubscriptionId: subEntity.id }
      });

      if (customer) {
        await prisma.customer.update({
          where: { id: customer.id },
          data: { autopayStatus: "ACTIVE" }
        });

        // This is a server-to-server delivery racing the browser's own
        // /subscription/autopay/verify call for the exact same charge — it
        // usually arrives first. Both paths now funnel through
        // activateRentalCycle so whichever wins fully populates the
        // customer record (rentalPlanDuration, subscriptionStart,
        // billingDay, subscriptionEnd) instead of only the fields this
        // handler used to set directly; activateRentalCycle's own
        // transactionId check makes running it from both paths a no-op the
        // second time.
        //
        // rentalPlanDuration rides along in the subscription's notes (set
        // at creation in createAutopaySubscription) since Razorpay's
        // payload has no other way to say which plan this mandate is for.
        // Falls back to whatever plan is already on file for subscriptions
        // created before that note existed.
        const rentalPlanDuration =
          Number(subEntity.notes?.rentalPlanDuration) || customer.rentalPlanDuration || customer.planDuration;

        await activateRentalCycle(customer.id, {
          rentalPlanDuration,
          rentalAmount: Math.round((paymentEntity.amount ?? 0) / 100),
          transactionId: paymentEntity.id,
          paymentMethod: "Razorpay"
        });
      }
    }
  }

  // Razorpay's event for a recurring charge attempt that failed after
  // retries — the manual "Generate Payment Link" action in the admin
  // dashboard remains the fallback for collecting that month's rent.
  if (payload.event === "subscription.halted") {
    const subEntity = payload.payload?.subscription?.entity;
    if (subEntity?.id) {
      await prisma.customer.updateMany({
        where: { razorpaySubscriptionId: subEntity.id },
        data: { autopayStatus: "FAILED" }
      });
    }
  }

  if (payload.event === "subscription.cancelled" || payload.event === "subscription.completed") {
    const subEntity = payload.payload?.subscription?.entity;
    if (subEntity?.id) {
      await prisma.customer.updateMany({
        where: { razorpaySubscriptionId: subEntity.id },
        data: { autopayStatus: "CANCELLED" }
      });
    }
  }

  res.json({ success: true });
}
