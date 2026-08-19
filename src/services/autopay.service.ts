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

// Shared by the manual monthly payment (verifyRentalPayment) and the first
// charge of a freshly-authorized autopay mandate (verifyAutopaySetup) — both
// end with the subscription activated and one RENTAL invoice, recorded
// identically regardless of which path triggered it.
export async function activateRentalCycle(customerId: string, input: ActivateRentalCycleInput) {
  // Idempotent: a duplicate client call (retry, double-submit, or a race
  // between the checkout handler and a webhook) for the same Razorpay
  // payment must not record it — and therefore charge the customer's plan
  // dates/invoice — twice. Mirrors the same guard already used on the
  // subscription.charged webhook handler.
  const existingInvoice = await prisma.invoice.findFirst({ where: { transactionId: input.transactionId } });
  if (existingInvoice) {
    const existingCustomer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    return { customer: existingCustomer, invoice: existingInvoice };
  }

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
// presents whatever the customer's bank supports. total_count=100 monthly
// cycles (~8 years) comfortably covers the 12/24-month committed plans plus
// the contract's month-to-month auto-renewal; a customer who somehow outlasts
// that would need a fresh mandate, which is an acceptable edge case for now.
export async function createAutopaySubscription(customerId: string, rentalPlanDuration: number, rentalAmount: number) {
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
      autopayStatus: "PENDING_AUTH"
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
