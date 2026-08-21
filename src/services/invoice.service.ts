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
  // The rental cycle this bill covers — only meaningful for type=RENTAL.
  // Distinct from documentDate (when the payment happened): a late payment
  // covers a period starting from the payment date, not the original due date.
  rentStartDate?: Date | null;
  rentEndDate?: Date | null;
  // Manual payment proof photo (e.g. bank transfer screenshot) — embedded
  // into the receipt PDF when present.
  proofUrl?: string | null;
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
        reason: input.reason ?? null,
        rentStartDate: input.rentStartDate ?? null,
        rentEndDate: input.rentEndDate ?? null,
        proofUrl: input.proofUrl ?? null
      }
    });
  });
}
