export type BillingFrequency = "DAILY" | "MONTHLY";

export function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

/**
 * Computes the next billing date for a subscription.
 *
 * `billingDay` must always be the ORIGINAL day-of-month the subscription started on
 * (e.g. 31), not the day of the previously clamped date (e.g. 28). Passing the
 * clamped date's day back in here causes drift: Jan 31 -> Feb 28 -> Mar 28 -> ...
 * instead of the correct Jan 31 -> Feb 28 -> Mar 31 -> ...
 */
export function calculateNextBillingDate(
  fromDate: Date,
  billingDay: number,
  frequency: BillingFrequency
): Date {
  if (frequency === "DAILY") {
    const next = new Date(fromDate);
    next.setDate(next.getDate() + 1);
    return next;
  }

  const year = fromDate.getFullYear();
  const month = fromDate.getMonth();

  let nextYear = year;
  let nextMonth = month + 1;
  if (nextMonth > 11) {
    nextMonth = 0;
    nextYear += 1;
  }

  const clampedDay = Math.min(billingDay, daysInMonth(nextYear, nextMonth));
  return new Date(nextYear, nextMonth, clampedDay);
}

/**
 * Adds `months` to fromDate while preserving the original billingDay, without
 * relying on Date.setMonth() month-arithmetic (which overflows for
 * end-of-month dates, e.g. Jan 31 + 1 month silently becomes a March date
 * before any clamping runs). Used for plan-length math (e.g. "3 months from
 * signup"), as opposed to calculateNextBillingDate's single-step renewal.
 */
export function addBillingMonths(fromDate: Date, months: number, billingDay: number): Date {
  const targetMonth = fromDate.getMonth() + months;
  const targetYear = fromDate.getFullYear() + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;

  const day = Math.min(billingDay, daysInMonth(targetYear, normalizedMonth));

  return new Date(
    targetYear,
    normalizedMonth,
    day,
    fromDate.getHours(),
    fromDate.getMinutes(),
    fromDate.getSeconds(),
    fromDate.getMilliseconds()
  );
}

/**
 * Number of calendar days between two dates, e.g. for prorating a billing period.
 * Compares dates (not instants), so time-of-day and DST shifts don't skew the count.
 */
export function getPeriodDays(periodStart: Date, periodEnd: Date): number {
  const start = new Date(periodStart.getFullYear(), periodStart.getMonth(), periodStart.getDate());
  const end = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), periodEnd.getDate());

  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round(
    (Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) -
      Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) /
      msPerDay
  );
}
