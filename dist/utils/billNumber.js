"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateBillNumber = generateBillNumber;
const TYPE_PREFIX = {
    SECURITY_DEPOSIT: "SEC",
    RENTAL: "REN",
    REFUND: "REF"
};
/**
 * Atomically allocates the next bill number for a type, resetting the
 * sequence every calendar year, e.g. SEC-2026-00001, SEC-2026-00002,
 * REN-2026-00001. Must be called inside the same transaction that creates
 * the Invoice row, so a failed invoice write never burns a number.
 */
async function generateBillNumber(tx, type, date = new Date()) {
    const year = date.getFullYear();
    const prefix = TYPE_PREFIX[type];
    const counterId = `${prefix}-${year}`;
    const counter = await tx.billCounter.upsert({
        where: { id: counterId },
        update: { lastSeq: { increment: 1 } },
        create: { id: counterId, lastSeq: 1 }
    });
    return `${prefix}-${year}-${String(counter.lastSeq).padStart(5, "0")}`;
}
//# sourceMappingURL=billNumber.js.map