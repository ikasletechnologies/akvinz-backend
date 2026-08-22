"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.securityDepositAmount = void 0;
exports.createInvoice = createInvoice;
const prisma_1 = require("../config/prisma");
const billNumber_1 = require("../utils/billNumber");
const planPricing_1 = require("../utils/planPricing");
Object.defineProperty(exports, "securityDepositAmount", { enumerable: true, get: function () { return planPricing_1.securityDepositAmount; } });
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
                reason: input.reason ?? null,
                rentStartDate: input.rentStartDate ?? null,
                rentEndDate: input.rentEndDate ?? null,
                proofUrl: input.proofUrl ?? null
            }
        });
    });
}
//# sourceMappingURL=invoice.service.js.map