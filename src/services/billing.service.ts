import { prisma } from "../config/prisma";

export interface RenewalResult {
  checked: number;
  pendingDue: number;
  completed: number;
}

/**
 * Flips every ACTIVE customer whose current billing period has ended to
 * PENDING_DUE — it does NOT charge anyone and does NOT advance
 * nextRentDueDate, which stays exactly as the real missed due date. Getting
 * back to ACTIVE only happens through an actual payment (activateRentalCycle
 * for manual payment, or the subscription.charged webhook for autopay), both
 * of which set a fresh nextRentDueDate themselves.
 *
 * The one case this DOES resolve on its own: if the customer's committed
 * term (planEndDate, fixed at first activation) has already been reached or
 * passed by their current nextRentDueDate, there's no term left to be
 * pending-due for, so they're marked CANCELLED instead.
 */
export async function processRenewals(now: Date = new Date()): Promise<RenewalResult> {
  const dueCustomers = await prisma.customer.findMany({
    where: {
      subscriptionStatus: "ACTIVE",
      nextRentDueDate: { lte: now },
      billingDay: { not: null },
      currentRentStartDate: { not: null },
      // Autopay customers are billed by Razorpay itself (see the
      // subscription.charged webhook) — this shouldn't touch their status.
      razorpaySubscriptionId: null
    }
  });

  let pendingDue = 0;
  let completed = 0;

  for (const customer of dueCustomers) {
    const nextRentDueDate = customer.nextRentDueDate as Date;
    const planAlreadyExpired = customer.planEndDate !== null && nextRentDueDate >= customer.planEndDate;

    await prisma.customer.update({
      where: { id: customer.id },
      data: { subscriptionStatus: planAlreadyExpired ? "CANCELLED" : "PENDING_DUE" }
    });

    if (planAlreadyExpired) completed += 1;
    else pendingDue += 1;
  }

  return { checked: dueCustomers.length, pendingDue, completed };
}
