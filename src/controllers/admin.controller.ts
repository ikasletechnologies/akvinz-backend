import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { razorpay } from "../config/razorpay";
import { processRenewals } from "../services/billing.service";
import { markPaymentLinkPaid } from "../services/paymentLink.service";
import { applyPlanChange } from "../services/planChange.service";

export function login(req: Request, res: Response): any {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: "Email and password are required" });
  }

  if (email !== env.admin.email || password !== env.admin.password) {
    return res.status(401).json({ success: false, message: "Invalid credentials" });
  }

  const token = jwt.sign({ email, role: "admin" }, env.admin.jwtSecret, { expiresIn: "12h" });
  res.json({ success: true, token });
}

// Builds a Prisma date-range filter for a `from`/`to` query pair (both
// optional, either can be omitted). Returns undefined entirely when neither
// is set, so callers can spread it into a `where` clause without adding an
// empty {gte: undefined, lte: undefined} object. `to` is treated as
// inclusive of the whole day.
function dateRangeFilter(from?: string, to?: string): { gte?: Date; lte?: Date } | undefined {
  if (!from && !to) return undefined;
  const filter: { gte?: Date; lte?: Date } = {};
  if (from) filter.gte = new Date(from);
  if (to) {
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    filter.lte = end;
  }
  return filter;
}

// "Assets Received" has no single-query answer: it's the count of customers
// whose MOST RECENT MACHINE_RECEIVED_WAREHOUSE return-process event is
// COMPLETED. Fetches that step's events (small volume — one rental
// company's returns) and reduces to the latest per customer in JS, since
// Prisma has no "latest row per group" aggregate.
async function countAssetsReceived(range?: { gte?: Date; lte?: Date }): Promise<number> {
  const events = await prisma.returnProcessEvent.findMany({
    where: { step: "MACHINE_RECEIVED_WAREHOUSE" },
    orderBy: { createdAt: "desc" },
    select: { customerId: true, status: true, eventDate: true }
  });

  const latestByCustomer = new Map<string, { status: string; eventDate: Date }>();
  for (const event of events) {
    if (!latestByCustomer.has(event.customerId)) {
      latestByCustomer.set(event.customerId, { status: event.status, eventDate: event.eventDate });
    }
  }

  let count = 0;
  for (const { status, eventDate } of latestByCustomer.values()) {
    if (status !== "COMPLETED") continue;
    if (range?.gte && eventDate < range.gte) continue;
    if (range?.lte && eventDate > range.lte) continue;
    count += 1;
  }
  return count;
}

export async function getStats(req: Request, res: Response): Promise<any> {
  try {
    const { from, to } = req.query as { from?: string; to?: string };
    const range = dateRangeFilter(from, to);

    const [
      totalCustomers,
      totalSubscribers,
      twelveMonthCustomers,
      twentyFourMonthCustomers,
      rentalPaidInvoices,
      rentalDue,
      returnsInitiated,
      refundedInvoices,
      rentalRevenueAgg,
      totalDepositsAgg,
      assetsReceived
    ] = await Promise.all([
      prisma.customer.count({ where: { createdAt: range } }),
      prisma.invoice.findMany({
        where: { type: "SECURITY_DEPOSIT", status: "FUNDED", createdAt: range },
        select: { customerId: true },
        distinct: ["customerId"]
      }),
      prisma.customer.count({ where: { planDuration: 12, subscriptionStatus: "ACTIVE", createdAt: range } }),
      prisma.customer.count({ where: { planDuration: 24, subscriptionStatus: "ACTIVE", createdAt: range } }),
      prisma.invoice.findMany({
        where: { type: "RENTAL", status: "FUNDED", createdAt: range },
        select: { customerId: true },
        distinct: ["customerId"]
      }),
      prisma.customer.count({
        where: {
          subscriptionStatus: "ACTIVE",
          subscriptionEnd: { lt: new Date(), ...(range?.gte ? { gte: range.gte } : {}), ...(range?.lte ? { lte: range.lte } : {}) }
        }
      }),
      prisma.customer.count({ where: { returnRequested: true, returnRequestedAt: range } }),
      prisma.invoice.findMany({
        where: { type: "REFUND", productType: "Security Deposit Refund", status: "REFUNDED", createdAt: range },
        select: { customerId: true },
        distinct: ["customerId"]
      }),
      prisma.invoice.aggregate({ where: { type: "RENTAL", status: "FUNDED", createdAt: range }, _sum: { amount: true } }),
      prisma.invoice.aggregate({ where: { type: "SECURITY_DEPOSIT", status: "FUNDED", createdAt: range }, _sum: { amount: true } }),
      countAssetsReceived(range)
    ]);

    res.json({
      success: true,
      stats: {
        totalCustomers,
        totalSubscribers: totalSubscribers.length,
        twelveMonthCustomers,
        twentyFourMonthCustomers,
        rentalPaid: rentalPaidInvoices.length,
        rentalDue,
        returnsInitiated,
        customersRefunded: refundedInvoices.length,
        rentalRevenue: rentalRevenueAgg._sum.amount || 0,
        totalDeposits: totalDepositsAgg._sum.amount || 0,
        assetsReceived
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function listCustomers(req: Request, res: Response): Promise<any> {
  try {
    const { search, paymentStatus, subscriptionStatus, returnRequested, page = "1", limit = "20" } = req.query as Record<string, string>;

    const pageNum = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit) || 20, 1), 100);

    const where: any = {};

    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { mobileNumber: { contains: search, mode: "insensitive" } }
      ];
    }

    if (paymentStatus) where.paymentStatus = paymentStatus;
    if (subscriptionStatus) where.subscriptionStatus = subscriptionStatus;
    if (returnRequested) where.returnRequested = returnRequested === "true";

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (pageNum - 1) * limitNum,
        take: limitNum
      }),
      prisma.customer.count({ where })
    ]);

    res.json({
      success: true,
      customers,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function listDrafts(req: Request, res: Response): Promise<any> {
  try {
    const { search, page = "1", limit = "20" } = req.query as Record<string, string>;

    const pageNum = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit) || 20, 1), 100);

    const where: any = {};

    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { mobileNumber: { contains: search, mode: "insensitive" } }
      ];
    }

    const [drafts, total] = await Promise.all([
      prisma.customerDraft.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (pageNum - 1) * limitNum,
        take: limitNum
      }),
      prisma.customerDraft.count({ where })
    ]);

    res.json({
      success: true,
      drafts,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function deleteDraft(req: Request, res: Response): Promise<any> {
  try {
    await prisma.customerDraft.delete({ where: { id: req.params.id as string } });
    res.json({ success: true, message: "Draft deleted" });
  } catch (error: any) {
    if (error.code === "P2025") {
      return res.status(404).json({ success: false, message: "Draft not found" });
    }
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function getCustomer(req: Request, res: Response): Promise<any> {
  try {
    const customer = await prisma.customer.findUnique({ where: { id: req.params.id as string } });
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }
    res.json({ success: true, customer });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function updateCustomer(req: Request, res: Response): Promise<any> {
  try {
    const allowedFields = [
      "fullName", "mobileNumber", "email", "addressLine1", "addressLine2",
      "city", "state", "pincode", "planDuration", "houseType",
      "paymentStatus", "rentalPlanDuration", "rentalAmount",
      "subscriptionStatus", "subscriptionStart", "subscriptionEnd", "billingDay",
      "returnRequested", "refundAmount", "modelName", "machineSerialNumber"
    ];

    const data: any = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) data[field] = req.body[field];
    }

    if (data.subscriptionStart) data.subscriptionStart = new Date(data.subscriptionStart);
    if (data.subscriptionEnd) data.subscriptionEnd = new Date(data.subscriptionEnd);
    if (data.planDuration !== undefined) data.planDuration = parseInt(data.planDuration);
    if (data.rentalPlanDuration !== undefined) data.rentalPlanDuration = parseInt(data.rentalPlanDuration);
    if (data.rentalAmount !== undefined) data.rentalAmount = parseInt(data.rentalAmount);
    if (data.billingDay !== undefined) data.billingDay = data.billingDay === "" ? null : parseInt(data.billingDay);
    if (data.refundAmount !== undefined) data.refundAmount = data.refundAmount === "" ? null : parseInt(data.refundAmount);
    if (data.returnRequested !== undefined) data.returnRequested = data.returnRequested === true || data.returnRequested === "true";

    const customer = await prisma.customer.update({
      where: { id: req.params.id as string },
      data
    });

    res.json({ success: true, customer });
  } catch (error: any) {
    if (error.code === "P2025") {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }
    if (error.code === "P2002") {
      return res.status(400).json({ success: false, message: "A customer with this email already exists." });
    }
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function deleteCustomer(req: Request, res: Response): Promise<any> {
  const customerId = req.params.id as string;
  try {
    // Deleting a customer also permanently erases their invoices, payment
    // links, payouts, and return-process history — there's no FK cascade in
    // the schema (invoices are normally kept as permanent billing records),
    // so it's done explicitly here in one transaction.
    await prisma.$transaction([
      prisma.invoice.deleteMany({ where: { customerId } }),
      prisma.returnProcessEvent.deleteMany({ where: { customerId } }),
      prisma.paymentLinkRequest.deleteMany({ where: { customerId } }),
      prisma.customerPayout.deleteMany({ where: { customerId } }),
      prisma.customer.delete({ where: { id: customerId } }),
    ]);
    res.json({ success: true, message: "Customer deleted" });
  } catch (error: any) {
    if (error.code === "P2025") {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function createPaymentLink(req: Request, res: Response): Promise<any> {
  try {
    const amount = Number(req.body.amount);
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: "A valid amount is required" });
    }

    // Set only when this link is generated from "Change Plan" as a deposit
    // top-up — once it's paid, the plan change applies automatically
    // instead of needing a separate manual confirmation.
    const planChangeTargetDuration = Number(req.body.planChangeTargetDuration);
    const hasPlanChangeTarget = planChangeTargetDuration === 12 || planChangeTargetDuration === 24;

    const customer = await prisma.customer.findUnique({ where: { id: req.params.id as string } });
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    const contact = customer.mobileNumber.startsWith("+")
      ? customer.mobileNumber
      : `+91${customer.mobileNumber.replace(/^0+/, "")}`;

    const paymentLink = await razorpay.paymentLink.create({
      amount: Math.round(amount * 100),
      currency: "INR",
      description: `Payment for ${customer.fullName}`,
      customer: {
        name: customer.fullName,
        email: customer.email,
        contact
      },
      notify: { sms: false, email: false },
      reminder_enable: false,
      expire_by: Math.floor(Date.now() / 1000) + 3600
    });

    await prisma.paymentLinkRequest.create({
      data: {
        customerId: customer.id,
        amount,
        razorpayPaymentLinkId: paymentLink.id,
        shortUrl: paymentLink.short_url,
        expireBy: new Date((paymentLink.expire_by as number) * 1000),
        planChangeTargetDuration: hasPlanChangeTarget ? planChangeTargetDuration : null
      }
    });

    res.json({ success: true, shortUrl: paymentLink.short_url, expireBy: paymentLink.expire_by });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.error?.description || error.message });
  }
}

export async function listCustomerPaymentLinks(req: Request, res: Response): Promise<any> {
  try {
    const paymentLinks = await prisma.paymentLinkRequest.findMany({
      where: { customerId: req.params.id as string },
      orderBy: { createdAt: "desc" }
    });
    res.json({ success: true, paymentLinks });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

// "Pay Customer" — a manual, immediate payout with no Razorpay involved.
// Always Completed the moment it's recorded (there's nothing to wait on).
export async function createPayout(req: Request, res: Response): Promise<any> {
  try {
    const amount = Number(req.body.amount);
    const reason = String(req.body.reason || "").trim();
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: "A valid amount is required" });
    }
    if (!reason) {
      return res.status(400).json({ success: false, message: "A reason is required" });
    }

    const customer = await prisma.customer.findUnique({ where: { id: req.params.id as string } });
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    const payout = await prisma.customerPayout.create({
      data: { customerId: customer.id, amount, reason }
    });

    res.json({ success: true, payout });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function listCustomerPayouts(req: Request, res: Response): Promise<any> {
  try {
    const payouts = await prisma.customerPayout.findMany({
      where: { customerId: req.params.id as string },
      orderBy: { createdAt: "desc" }
    });
    res.json({ success: true, payouts });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

// Fallback for when the Razorpay webhook hasn't fired (e.g. local dev, where
// Razorpay can't reach localhost) or is delayed — admin confirms payment
// after checking the Razorpay dashboard themselves.
export async function markPaymentLinkAsPaid(req: Request, res: Response): Promise<any> {
  try {
    const updated = await markPaymentLinkPaid(req.params.linkId as string, null);
    if (!updated) {
      return res.status(404).json({ success: false, message: "Payment link not found" });
    }
    res.json({ success: true, paymentLink: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

// Switches a customer between the 12-month and 24-month plans (amounts per
// planPricing.ts). The deposit difference is recorded as a top-up invoice
// (upgrade) or a refund invoice (downgrade) so it stays auditable alongside
// the customer's other receipts.
export async function changePlan(req: Request, res: Response): Promise<any> {
  try {
    const newPlanDuration = Number(req.body.newPlanDuration);
    if (newPlanDuration !== 12 && newPlanDuration !== 24) {
      return res.status(400).json({ success: false, message: "Plan must be 12 or 24 months" });
    }

    const requestedAmount = Number(req.body.amountHandled);
    const result = await applyPlanChange({
      customerId: req.params.id as string,
      newPlanDuration,
      amountHandled: Number.isFinite(requestedAmount) && requestedAmount >= 0 ? requestedAmount : undefined,
      paymentMethod: "Manual"
    });

    if (result.status === "not_found") {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }
    if (result.status === "already_on_plan") {
      return res.status(400).json({ success: false, message: "Customer is already on this plan" });
    }

    res.json({ success: true, customer: result.customer, invoice: result.invoice, difference: result.difference, recordedAmount: result.recordedAmount });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function triggerRenewals(_req: Request, res: Response): Promise<any> {
  try {
    const result = await processRenewals();
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}
