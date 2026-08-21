import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { razorpay } from "../config/razorpay";
import { processRenewals } from "../services/billing.service";
import { markPaymentLinkPaid } from "../services/paymentLink.service";
import { applyPlanChange } from "../services/planChange.service";
import { createInvoice } from "../services/invoice.service";
import { securityDepositAmount } from "../utils/planPricing";
import { createAutopaySubscription } from "../services/autopay.service";
import { buildFileUrl } from "../utils/fileUrl";

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

    // A Subscriber = paid the security deposit (every Customer row implies
    // this — see finalizeRegistration/createCustomer, a row only exists
    // once payment succeeds) and hasn't finally been refunded/closed yet.
    // paymentStatus is COMPLETED -> PENDING_REFUND (return requested) ->
    // REFUNDED (closeAccount, the final step) — so "not REFUNDED" is the
    // whole condition. Deliberately NOT keyed off subscriptionStatus or
    // Invoice rows: subscriptionStatus flips to CANCELLED the moment a
    // return is *requested*, well before any refund happens, so it can't
    // tell an in-progress return apart from a completed one; and a
    // manually/offline-created customer (admin.controller.createCustomer)
    // never gets a SECURITY_DEPOSIT invoice at all, so relying on Invoice
    // rows silently excluded them.
    const subscriberWhere = { paymentStatus: { not: "REFUNDED" } };

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
      prisma.customer.count({ where: { ...subscriberWhere, createdAt: range } }),
      prisma.customer.count({ where: { ...subscriberWhere, planDuration: 12, createdAt: range } }),
      prisma.customer.count({ where: { ...subscriberWhere, planDuration: 24, createdAt: range } }),
      prisma.invoice.findMany({
        where: { type: "RENTAL", status: "FUNDED", createdAt: range },
        select: { customerId: true },
        distinct: ["customerId"]
      }),
      prisma.customer.count({ where: { subscriptionStatus: "PENDING_DUE", subscriptionEnd: range } }),
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
        totalSubscribers,
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

// Lets an admin add a customer directly — no OTP, no draft, no payment
// flow. Used for entries that happened outside the normal online journey
// (e.g. an offline/cash signup). paymentStatus is set to COMPLETED since
// there's no real online payment to leave PENDING against; PENDING isn't a
// selectable option in the admin edit form's Payment Status dropdown, so
// leaving it there would strand the customer with no way to change it via
// the UI.
export async function createCustomer(req: Request, res: Response): Promise<any> {
  try {
    const {
      fullName, mobileNumber, email,
      addressLine1, addressLine2, city, state, pincode,
      planDuration, houseType
    } = req.body;

    if (!fullName || !mobileNumber || !email || !addressLine1 || !city || !state || !pincode || !planDuration || !houseType) {
      return res.status(400).json({ success: false, message: "Please fill in all required fields." });
    }

    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;

    const customer = await prisma.customer.create({
      data: {
        fullName,
        mobileNumber,
        email,
        addressLine1,
        addressLine2: addressLine2 || null,
        city,
        state,
        pincode,
        planDuration: parseInt(planDuration),
        houseType,
        paymentStatus: "COMPLETED",
        aadharFrontImageUrl: files ? buildFileUrl(files, "aadharFrontFile") : null,
        aadharBackImageUrl: files ? buildFileUrl(files, "aadharBackFile") : null,
        panFrontImageUrl: files ? buildFileUrl(files, "panFrontFile") : null,
        panBackImageUrl: files ? buildFileUrl(files, "panBackFile") : null,
        residenceDocUrl: files ? buildFileUrl(files, "residenceFile") : null
      }
    });

    res.json({ success: true, customer });
  } catch (error: any) {
    if (error.code === "P2002") {
      return res.status(400).json({ success: false, message: "A customer with this mobile number or email already exists." });
    }
    res.status(500).json({ success: false, message: error.message });
  }
}

// Upload field name -> Customer column, shared by both document endpoints
// below and matching the same upload field names /register already uses.
const DOCUMENT_UPLOAD_FIELDS: Record<string, string> = {
  aadharFrontFile: "aadharFrontImageUrl",
  aadharBackFile: "aadharBackImageUrl",
  panFrontFile: "panFrontImageUrl",
  panBackFile: "panBackImageUrl",
  residenceFile: "residenceDocUrl",
  planChangeRefundProofFile: "planChangeRefundProofUrl"
};
const DOCUMENT_DB_FIELDS = new Set(Object.values(DOCUMENT_UPLOAD_FIELDS));

// Lets an admin upload or replace a customer's KYC documents after the
// fact (e.g. a blurry scan, or one collected later than the others).
// Accepts any subset of the 5 file fields — only the ones present are
// updated, the rest are left as-is.
export async function uploadCustomerDocuments(req: Request, res: Response): Promise<any> {
  try {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    if (!files || Object.keys(files).length === 0) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    const data: Record<string, string> = {};
    for (const [uploadField, dbField] of Object.entries(DOCUMENT_UPLOAD_FIELDS)) {
      const url = buildFileUrl(files, uploadField);
      if (url) data[dbField] = url;
    }

    const customer = await prisma.customer.update({
      where: { id: req.params.id as string },
      data
    });

    res.json({ success: true, customer });
  } catch (error: any) {
    if (error.code === "P2025") {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function deleteCustomerDocument(req: Request, res: Response): Promise<any> {
  try {
    const field = req.params.field as string;
    if (!DOCUMENT_DB_FIELDS.has(field)) {
      return res.status(400).json({ success: false, message: "Invalid document field" });
    }

    const customer = await prisma.customer.update({
      where: { id: req.params.id as string },
      data: { [field]: null }
    });

    res.json({ success: true, customer });
  } catch (error: any) {
    if (error.code === "P2025") {
      return res.status(404).json({ success: false, message: "Customer not found" });
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
      "returnRequested", "refundAmount", "modelName", "machineSerialNumber",
      "bankAccountHolderName", "bankName", "bankIfscCode", "bankAccountNumber"
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

// Admin-triggered: creates a fresh Razorpay Subscription (never a
// reactivation of an old cancelled one — Razorpay doesn't support that) and
// hands back its short_url, the same way createPaymentLink above hands back
// a shareable link for a one-time payment. Autopay only flips to ACTIVE once
// the customer opens that link, authorizes it themselves, and Razorpay
// confirms via webhook (see webhook.controller.ts) — this call just starts
// that process, it does not activate anything itself.
export async function activateAutopay(req: Request, res: Response): Promise<any> {
  try {
    const customer = await prisma.customer.findUnique({ where: { id: req.params.id as string } });
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }
    if (!customer.rentalPlanDuration || !customer.rentalAmount) {
      return res.status(400).json({ success: false, message: "This customer has no established rental plan/amount yet — activate their rental first." });
    }

    const subscription = await createAutopaySubscription(customer.id, customer.rentalPlanDuration, customer.rentalAmount);
    res.json({ success: true, shortUrl: subscription.short_url });
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
// Also produces a downloadable REFUND-type invoice (see Receipts) carrying
// the admin's typed reason, so every manual payout stays auditable.
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

    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const proofUrl = files ? buildFileUrl(files, "proofFile") : null;
    if (!proofUrl) {
      return res.status(400).json({ success: false, message: "Payment proof is required" });
    }

    const customer = await prisma.customer.findUnique({ where: { id: req.params.id as string } });
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    const payout = await prisma.customerPayout.create({
      data: { customerId: customer.id, amount, reason, proofUrl }
    });

    const invoice = await createInvoice({
      type: "REFUND",
      customerId: customer.id,
      productType: reason,
      amount,
      paymentMethod: "Manual",
      status: "REFUNDED",
      reason
    });

    res.json({ success: true, payout, invoice });
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

    const customerId = req.params.id as string;
    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    const difference = securityDepositAmount(newPlanDuration) - securityDepositAmount(customer.planDuration);
    if (difference < 0 && !customer.planChangeRefundProofUrl) {
      return res.status(400).json({
        success: false,
        message: "Upload proof that the deposit refund was sent to the customer before confirming this downgrade."
      });
    }
    if (difference > 0) {
      const paidTopUpLink = await prisma.paymentLinkRequest.findFirst({
        where: { customerId, status: "PAID", planChangeTargetDuration: newPlanDuration }
      });
      if (!paidTopUpLink) {
        return res.status(400).json({
          success: false,
          message: "Generate a top-up link and mark it as paid before confirming this upgrade."
        });
      }
    }

    const requestedAmount = Number(req.body.amountHandled);
    const result = await applyPlanChange({
      customerId,
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
