import { prisma } from "../config/prisma";
import { generateBillNumber, InvoiceType } from "../utils/billNumber";
import { securityDepositAmount } from "../utils/planPricing";

export { securityDepositAmount };

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
