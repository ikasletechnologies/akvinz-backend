import { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { razorpay } from "../config/razorpay";
import { verifyRazorpaySignature, verifyRazorpaySubscriptionSignature } from "../services/payment.service";
import { activateRentalCycle, createAutopaySubscription } from "../services/autopay.service";
import { finalizeRegistration } from "../services/registration.service";

export async function createOrder(req: Request, res: Response): Promise<any> {
  try {
    const { amount, notes } = req.body;

    if (!amount) {
      return res.status(400).json({ success: false, message: "Amount is required" });
    }

    const options = {
      amount: amount * 100, // amount in smallest currency unit (paise)
      currency: "INR",
      receipt: `receipt_order_${Date.now()}`,
      // Attached so the order.paid webhook can identify what this order was
      // for (e.g. { draftId }) without depending on the customer's browser
      // to report back — see webhook.controller.ts.
      notes: notes || {}
    };

    const order = await razorpay.orders.create(options);
    res.json({ success: true, order });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}

// This is where a Draft actually becomes a Customer. Registration itself
// (customer.controller.register) only ever writes a Draft; nothing shows up
// under Customers until the security-deposit payment is verified here. If
// the signature is invalid (payment failed/cancelled/tampered), the Draft is
// left untouched so the person can be followed up with or retry later.
//
// finalizeRegistration is idempotent and shared with the order.paid webhook
// (webhook.controller.ts) — if that already finished this same payment
// (e.g. the customer's browser closed right after paying), this just reports
// back the same customer/invoice instead of erroring or double-creating.
export async function verifyPayment(req: Request, res: Response): Promise<any> {
  try {
    const { draftId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    const isValid = verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
    if (!isValid) {
      return res.status(400).json({ success: false, message: "Invalid signature sent!" });
    }

    if (!draftId) {
      return res.status(400).json({ success: false, message: "draftId is required" });
    }

    const result = await finalizeRegistration(draftId, razorpay_order_id, razorpay_payment_id);

    if (result.status === "draft_not_found") {
      return res.status(404).json({ success: false, message: "Registration draft not found. Please fill the form again." });
    }
    if (result.status === "incomplete") {
      return res.status(400).json({ success: false, message: "Registration details are incomplete." });
    }
    if (result.status === "mobile_conflict") {
      return res.status(400).json({ success: false, message: "A customer with this mobile number is already registered." });
    }
    if (result.status === "email_conflict") {
      return res.status(400).json({ success: false, message: "A customer with this email is already registered." });
    }

    return res.json({
      success: true,
      message: "Payment verified successfully",
      customerId: result.customer!.id,
      invoiceId: result.invoiceId ?? undefined
    });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(400).json({ success: false, message: "A customer with this mobile number or email is already registered." });
    }
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function verifyRentalPayment(req: Request, res: Response): Promise<any> {
  try {
    const { customerId, rentalPlanDuration, rentalAmount, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    const isValid = verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);

    if (isValid) {
      let invoiceId: string | undefined;
      if (customerId) {
        const { invoice } = await activateRentalCycle(customerId, {
          rentalPlanDuration,
          rentalAmount,
          transactionId: razorpay_payment_id,
          orderId: razorpay_order_id,
          paymentMethod: "Razorpay"
        });
        invoiceId = invoice.id;
      }
      return res.json({ success: true, message: "Rental Payment verified successfully", invoiceId });
    } else {
      return res.status(400).json({ success: false, message: "Invalid signature sent!" });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}

// Step 1 of setting up rent autopay: creates the Razorpay Plan + Subscription
// for this customer's chosen rental plan and returns the subscription id, so
// the frontend can open Razorpay Checkout in subscription mode (the customer
// authorizes the mandate via GPay/PhonePe/Paytm/any UPI app, card, or NACH).
export async function setupAutopay(req: Request, res: Response): Promise<any> {
  try {
    const { customerId, rentalPlanDuration, rentalAmount } = req.body;

    if (!customerId || !rentalPlanDuration || !rentalAmount) {
      return res.status(400).json({ success: false, message: "customerId, rentalPlanDuration and rentalAmount are required" });
    }

    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    const subscription = await createAutopaySubscription(customerId, rentalPlanDuration, rentalAmount);
    res.json({ success: true, subscriptionId: subscription.id });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}

// Step 2: called once the customer authorizes the mandate in Razorpay
// Checkout. This first authorization charge activates the subscription the
// same way a manual rental payment does (activateRentalCycle) — every charge
// after this one arrives automatically via the subscription.charged webhook.
export async function verifyAutopaySetup(req: Request, res: Response): Promise<any> {
  try {
    const {
      customerId,
      rentalPlanDuration,
      rentalAmount,
      razorpay_payment_id,
      razorpay_subscription_id,
      razorpay_signature
    } = req.body;

    const isValid = verifyRazorpaySubscriptionSignature(razorpay_subscription_id, razorpay_payment_id, razorpay_signature);
    if (!isValid) {
      return res.status(400).json({ success: false, message: "Invalid signature sent!" });
    }

    if (!customerId) {
      return res.status(400).json({ success: false, message: "customerId is required" });
    }

    await prisma.customer.update({
      where: { id: customerId },
      data: { autopayStatus: "ACTIVE" }
    });

    const { invoice } = await activateRentalCycle(customerId, {
      rentalPlanDuration,
      rentalAmount,
      transactionId: razorpay_payment_id,
      paymentMethod: "Razorpay"
    });

    return res.json({ success: true, message: "Autopay set up successfully", invoiceId: invoice.id });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}
