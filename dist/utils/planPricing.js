"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.securityDepositAmount = securityDepositAmount;
exports.rentalAmountForPlan = rentalAmountForPlan;
// Fixed business rule per plan length — not something we trust the client to
// tell us for a financial document (deposit) or billing (monthly rental).
const SECURITY_DEPOSIT_AMOUNTS = {
    12: 3,
    24: 4
};
const RENTAL_AMOUNTS = {
    12: 2,
    24: 1
};
function securityDepositAmount(planDuration) {
    return SECURITY_DEPOSIT_AMOUNTS[planDuration] ?? SECURITY_DEPOSIT_AMOUNTS[12];
}
function rentalAmountForPlan(planDuration) {
    return RENTAL_AMOUNTS[planDuration] ?? RENTAL_AMOUNTS[12];
}
//# sourceMappingURL=planPricing.js.map