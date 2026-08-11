"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createInvoice = createInvoice;
exports.securityDepositAmount = securityDepositAmount;
const prisma_1 = require("../config/prisma");
const billNumber_1 = require("../utils/billNumber");
async function createInvoice(input) {
    return prisma_1.prisma.$transaction(async (tx) => {
        const billNumber = await (0, billNumber_1.generateBillNumber)(tx, input.type);
        return tx.invoice.create({
            data: {
                billNumber,
                type: input.type,
                customerId: input.customerId,
                productType: input.productType,
                amount: input.amount,
                paymentMethod: input.paymentMethod,
                transactionId: input.transactionId ?? null,
                status: input.status,
                reason: input.reason ?? null
            }
        });
    });
}
// Deposit amount is a fixed business rule per plan length, not something we
// trust the client to tell us for a financial document.
const SECURITY_DEPOSIT_AMOUNTS = {
    12: 2999,
    24: 3999
};
function securityDepositAmount(planDuration) {
    return SECURITY_DEPOSIT_AMOUNTS[planDuration] ?? SECURITY_DEPOSIT_AMOUNTS[12];
}
//# sourceMappingURL=invoice.service.js.map