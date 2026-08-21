import { prisma } from "../config/prisma";
import { razorpay } from "../config/razorpay";
import { createInvoice } from "./invoice.service";
import { calculateNextBillingDate } from "../utils/billing";

interface ActivateRentalCycleInput {
  rentalPlanDuration: number;
  rentalAmount: number;
  transactionId: string;
  orderId?: string;
  paymentMethod: "Razorpay";
}

// Used by the one-time monthly rent payment (verifyRentalPayment) — marks
// the subscription active/current and records one RENTAL invoice. Autopay's
// own recurring charges are handled independently by the
// subscription.charged webhook (webhook.controller.ts), not this function.
export async function activateRentalCycle(customerId: string, input: ActivateRentalCycleInput) {
  const newStart = new Date();
  const billingDay = newStart.getDate();
  const newEnd = calculateNextBillingDate(newStart, billingDay, "MONTHLY");

  const customer = await prisma.customer.update({
    where: { id: customerId },
    data: {
      rentalPlanDuration: input.rentalPlanDuration,
      rentalAmount: input.rentalAmount,
      subscriptionStatus: "ACTIVE",
      subscriptionStart: newStart,
      subscriptionEnd: newEnd,
      billingDay,
      lastPaymentDate: newStart,
      razorpayPaymentId: input.transactionId,
      ...(input.orderId ? { razorpayOrderId: input.orderId } : {})
    }
  });

  const invoice = await createInvoice({
    type: "RENTAL",
    customerId,
    productType: "Water Purifier",
    amount: input.rentalAmount,
    paymentMethod: input.paymentMethod,
    transactionId: input.transactionId,
    status: "FUNDED"
  });

  return { customer, invoice };
}

// Creates a Razorpay Plan + Subscription for this customer's rent. The
// mandate is UPI-app-agnostic (GPay/PhonePe/Paytm/etc.) — Razorpay Checkout
// (or the subscription's own short_url authorization page) presents whatever
// the customer's bank supports. total_count=100 monthly cycles (~8 years)
// comfortably covers the 12/24-month committed plans plus the contract's
// month-to-month auto-renewal; a customer who somehow outlasts that would
// need a fresh mandate, which is an acceptable edge case for now.
//
// Always creates a brand-new subscription — a cancelled Razorpay mandate can
// never be turned back on, so "activate autopay again" after a return is
// always a fresh mandate, not a reactivation. The one thing this guards
// against is creating a SECOND mandate on top of one that's already ACTIVE;
// a stale PENDING (an earlier attempt that was abandoned before
// authorization) is left retryable on purpose — this just overwrites it.
export async function createAutopaySubscription(customerId: string, rentalPlanDuration: number, rentalAmount: number) {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) {
    throw new Error("Customer not found");
  }
  if (customer.autopayStatus === "ACTIVE") {
    throw new Error("Autopay is already active for this customer");
  }

  const plan = await razorpay.plans.create({
    period: "monthly",
    interval: 1,
    item: {
      name: `AKVINZ Rental Autopay - ${rentalPlanDuration} Month Plan`,
      amount: rentalAmount * 100,
      currency: "INR"
    }
  });

  const subscription = await razorpay.subscriptions.create({
    plan_id: plan.id,
    customer_notify: 1,
    total_count: 100,
    notes: { customerId }
  });

  await prisma.customer.update({
    where: { id: customerId },
    data: {
      razorpayPlanId: plan.id,
      razorpaySubscriptionId: subscription.id,
      autopayStatus: "PENDING"
    }
  });

  return subscription;
}

// Cancels the customer's autopay mandate, if one exists. Safe to call even
// when there is none (e.g. a return request from a customer who never set
// up autopay) — it's a no-op in that case.
export async function cancelAutopay(customerId: string) {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer?.razorpaySubscriptionId) return;

  try {
    await razorpay.subscriptions.cancel(customer.razorpaySubscriptionId);
  } catch (error: any) {
    // Already cancelled/expired on Razorpay's side — still clear our local
    // status so the dashboard doesn't keep showing it as active.
    if (error?.statusCode !== 400) throw error;
  }

  await prisma.customer.update({
    where: { id: customerId },
    data: { autopayStatus: "CANCELLED" }
  });
}
