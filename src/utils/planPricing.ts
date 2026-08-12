// Fixed business rule per plan length — not something we trust the client to
// tell us for a financial document (deposit) or billing (monthly rental).
const SECURITY_DEPOSIT_AMOUNTS: Record<number, number> = {
  12: 3,
  24: 4
};

const RENTAL_AMOUNTS: Record<number, number> = {
  12: 2,
  24: 1
};

export function securityDepositAmount(planDuration: number): number {
  return SECURITY_DEPOSIT_AMOUNTS[planDuration] ?? SECURITY_DEPOSIT_AMOUNTS[12];
}

export function rentalAmountForPlan(planDuration: number): number {
  return RENTAL_AMOUNTS[planDuration] ?? RENTAL_AMOUNTS[12];
}
