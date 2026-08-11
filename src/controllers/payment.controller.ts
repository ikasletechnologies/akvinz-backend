import { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { razorpay } from "../config/razorpay";
import { verifyRazorpaySignature } from "../services/payment.service";
import { calculateNextBillingDate } from "../utils/billing";
import { createInvoice, securityDepositAmount } from "../services/invoice.service";

export async function createOrder(req: Request, res: Response): Promise<any> {
  try {
    const { amount } = req.body;

    if (!amount) {
      return res.status(400).json({ success: false, message: "Amount is required" });
    }

    const options = {
      amount: amount * 100, // amount in smallest currency unit (paise)
      currency: "INR",
      receipt: `receipt_order_${Date.now()}`
    };

    const order = await razorpay.orders.create(options);
    res.json({ success: true, order });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function verifyPayment(req: Request, res: Response): Promise<any> {
  try {
    const { customerId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    const isValid = verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);

    if (isValid) {
      let invoiceId: string | undefined;
      if (customerId) {
        const customer = await prisma.customer.update({
          where: { id: customerId },
          data: {
            paymentStatus: "COMPLETED",
            razorpayOrderId: razorpay_order_id,
            razorpayPaymentId: razorpay_payment_id
          }
        });

        const invoice = await createInvoice({
          type: "SECURITY_DEPOSIT",
          customerId: customer.id,
          productType: "Refundable Security Deposit",
          amount: securityDepositAmount(customer.planDuration),
          paymentMethod: "Razorpay",
          transactionId: razorpay_payment_id,
          status: "FUNDED"
        });
        invoiceId = invoice.id;
      }
      return res.json({ success: true, message: "Payment verified successfully", invoiceId });
    } else {
      if (customerId) {
        await prisma.customer.update({
          where: { id: customerId },
          data: {
            paymentStatus: "FAILED",
            razorpayOrderId: razorpay_order_id,
            razorpayPaymentId: razorpay_payment_id
          }
        });
      }
      return res.status(400).json({ success: false, message: "Invalid signature sent!" });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function verifyRentalPayment(req: Request, res: Response): Promise<any> {
  try {
    const { customerId, rentalPlanDuration, rentalAmount, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    const isValid = verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);

    if (isValid) {
      let invoiceId: string | undefined;
      if (customerId) {
        const newStart = new Date();
        const billingDay = newStart.getDate();
        const newEnd = calculateNextBillingDate(newStart, billingDay, "MONTHLY");

        await prisma.customer.update({
          where: { id: customerId },
          data: {
            rentalPlanDuration,
            rentalAmount,
            subscriptionStatus: "ACTIVE",
            subscriptionStart: newStart,
            subscriptionEnd: newEnd,
            billingDay,
            lastPaymentDate: newStart,
            razorpayOrderId: razorpay_order_id,
            razorpayPaymentId: razorpay_payment_id
          }
        });

        const invoice = await createInvoice({
          type: "RENTAL",
          customerId,
          productType: "Water Purifier",
          amount: rentalAmount,
          paymentMethod: "Razorpay",
          transactionId: razorpay_payment_id,
          status: "FUNDED"
        });
        invoiceId = invoice.id;
      }
      return res.json({ success: true, message: "Rental Payment verified successfully", invoiceId });
    } else {
      return res.status(400).json({ success: false, message: "Invalid signature sent!" });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}
