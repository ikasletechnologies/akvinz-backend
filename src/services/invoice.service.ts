import { prisma } from "../config/prisma";
import { generateBillNumber, InvoiceType } from "../utils/billNumber";

interface CreateInvoiceInput {
  type: InvoiceType;
  customerId: string;
  productType: string;
  amount: number;
  paymentMethod: string;
  transactionId?: string | null;
  status: string;
  reason?: string | null;
}

export async function createInvoice(input: CreateInvoiceInput) {
  return prisma.$transaction(async (tx) => {
    const billNumber = await generateBillNumber(tx, input.type);
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
const SECURITY_DEPOSIT_AMOUNTS: Record<number, number> = {
  12: 2999,
  24: 3999
};

export function securityDepositAmount(planDuration: number): number {
  return SECURITY_DEPOSIT_AMOUNTS[planDuration] ?? SECURITY_DEPOSIT_AMOUNTS[12];
}
