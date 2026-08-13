import { prisma } from "../config/prisma";
import { addBillingMonths } from "../utils/billing";

export interface RenewalResult {
  checked: number;
  pendingDue: number;
  completed: number;
}

/**
 * Flips every ACTIVE customer whose current billing period has ended to
 * PENDING_DUE — it does NOT charge anyone and does NOT advance
 * subscriptionEnd, which stays exactly as the real missed due date. Getting
 * back to ACTIVE only happens through an actual payment (activateRentalCycle
 * for manual payment, or the subscription.charged webhook for autopay), both
 * of which set a fresh subscriptionEnd themselves.
 *
 * The one case this DOES resolve on its own: if the customer's committed
 * term (rentalPlanDuration months from subscriptionStart, via
 * addBillingMonths) has already been reached or passed by their current
 * subscriptionEnd, there's no term left to be pending-due for, so they're
 * marked CANCELLED instead.
 */
export async function processRenewals(now: Date = new Date()): Promise<RenewalResult> {
  const dueCustomers = await prisma.customer.findMany({
    where: {
      subscriptionStatus: "ACTIVE",
      subscriptionEnd: { lte: now },
      billingDay: { not: null },
      subscriptionStart: { not: null },
      // Autopay customers are billed by Razorpay itself (see the
      // subscription.charged webhook) — this shouldn't touch their status.
      razorpaySubscriptionId: null
    }
  });

  let pendingDue = 0;
  let completed = 0;

  for (const customer of dueCustomers) {
    const billingDay = customer.billingDay as number;
    const start = customer.subscriptionStart as Date;
    const planDuration = customer.rentalPlanDuration ?? 0;
    const subscriptionEnd = customer.subscriptionEnd as Date;

    const planEnd = planDuration > 0 ? addBillingMonths(start, planDuration, billingDay) : null;
    const planAlreadyExpired = planEnd !== null && subscriptionEnd >= planEnd;

    await prisma.customer.update({
      where: { id: customer.id },
      data: { subscriptionStatus: planAlreadyExpired ? "CANCELLED" : "PENDING_DUE" }
    });

    if (planAlreadyExpired) completed += 1;
    else pendingDue += 1;
  }

  return { checked: dueCustomers.length, pendingDue, completed };
}
