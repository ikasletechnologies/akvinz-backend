import { prisma } from "../config/prisma";
import { addBillingMonths, calculateNextBillingDate } from "../utils/billing";

export interface RenewalResult {
  checked: number;
  renewed: number;
  completed: number;
}

/**
 * Advances subscriptionEnd for every ACTIVE customer whose current billing
 * period has ended. Always recalculates from billingDay (the original
 * anchor day-of-month), never from a previously clamped date, so a plan
 * anchored on the 31st goes Jan 31 -> Feb 28 -> Mar 31, not Jan 31 -> Feb 28
 * -> Mar 28.
 *
 * Each candidate renewal date is checked against planEnd (rentalPlanDuration
 * months from subscriptionStart, via addBillingMonths) before being applied —
 * so even after a long gap between sweeps, advancement stops exactly at
 * planEnd rather than overshooting and correcting afterward. Once reached,
 * the subscription is marked CANCELLED instead of rolled forward further.
 */
export async function processRenewals(now: Date = new Date()): Promise<RenewalResult> {
  const dueCustomers = await prisma.customer.findMany({
    where: {
      subscriptionStatus: "ACTIVE",
      subscriptionEnd: { lte: now },
      billingDay: { not: null },
      subscriptionStart: { not: null }
    }
  });

  let renewed = 0;
  let completed = 0;

  for (const customer of dueCustomers) {
    const billingDay = customer.billingDay as number;
    const start = customer.subscriptionStart as Date;
    const planDuration = customer.rentalPlanDuration ?? 0;

    const planEnd = planDuration > 0 ? addBillingMonths(start, planDuration, billingDay) : null;

    let nextEnd = customer.subscriptionEnd as Date;
    let completedPlan = false;

    while (nextEnd <= now) {
      const candidate = calculateNextBillingDate(nextEnd, billingDay, "MONTHLY");
      if (planEnd && candidate >= planEnd) {
        nextEnd = planEnd;
        completedPlan = true;
        break;
      }
      nextEnd = candidate;
    }

    if (completedPlan) {
      await prisma.customer.update({
        where: { id: customer.id },
        data: { subscriptionEnd: nextEnd, subscriptionStatus: "CANCELLED" }
      });
      completed += 1;
    } else {
      await prisma.customer.update({
        where: { id: customer.id },
        data: { subscriptionEnd: nextEnd }
      });
      renewed += 1;
    }
  }

  return { checked: dueCustomers.length, renewed, completed };
}
