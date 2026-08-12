import { Request, Response } from "express";
import { Prisma, CustomerDraft } from "@prisma/client";
import { prisma } from "../config/prisma";
import { buildFileUrl } from "../utils/fileUrl";
import { createInvoice } from "../services/invoice.service";

type DraftUpsertResult =
  | { status: "customer_exists" }
  | { status: "ok"; draft: CustomerDraft; resumedDraftId?: string };

// Shared by saveDraft (autosave while typing) and register (the final
// "submit registration" step, which now also just writes a draft — a
// Customer row is only ever created once payment succeeds, in verifyPayment).
// Keeps the "one draft per mobile number" and "mobile numbers are only
// checked against real Customers" rules in one place.
async function upsertDraft(draftId: string, data: Omit<Prisma.CustomerDraftCreateInput, "id">): Promise<DraftUpsertResult> {
  const mobileNumber = data.mobileNumber ?? undefined;

  if (mobileNumber) {
    const existingCustomer = await prisma.customer.findUnique({ where: { mobileNumber } });
    if (existingCustomer) {
      return { status: "customer_exists" };
    }

    // A draft for this mobile number may already exist under a different
    // draftId (e.g. a previous attempt on another device/browser, or after
    // local storage was cleared). Resume that row instead of letting a
    // second draft for the same person pile up.
    const existingDraft = await prisma.customerDraft.findUnique({ where: { mobileNumber } });
    if (existingDraft && existingDraft.id !== draftId) {
      const [, resumedDraft] = await prisma.$transaction([
        prisma.customerDraft.deleteMany({ where: { id: draftId } }),
        prisma.customerDraft.update({ where: { id: existingDraft.id }, data })
      ]);
      return { status: "ok", draft: resumedDraft, resumedDraftId: resumedDraft.id };
    }
  }

  const draft = await prisma.customerDraft.upsert({
    where: { id: draftId },
    update: data,
    create: { id: draftId, ...data }
  });
  return { status: "ok", draft };
}

// The final step of filling out the registration form. This does NOT create
// a Customer — it only finalizes the Draft (now including uploaded document
// URLs) so the person can proceed to payment. A Customer only comes into
// existence once that payment succeeds (see verifyPayment in
// payment.controller.ts). If payment is cancelled, fails, or is never
// completed, this row simply remains a Draft for follow-up.
export async function register(req: Request, res: Response): Promise<any> {
  try {
    const {
      draftId,
      fullName,
      mobileNumber,
      email,
      addressLine1,
      addressLine2,
      city,
      state,
      pincode,
      planDuration,
      houseType,
      residenceDocType
    } = req.body;

    if (!draftId) {
      return res.status(400).json({ success: false, message: "draftId is required" });
    }

    const files = req.files as { [fieldname: string]: Express.Multer.File[] };

    const data = {
      fullName,
      mobileNumber,
      email,
      addressLine1,
      addressLine2: addressLine2 || null,
      city,
      state,
      pincode,
      planDuration: planDuration ? parseInt(planDuration) : undefined,
      houseType,
      residenceDocType,
      // Fall back to undefined (not null) so re-submitting a resumed draft
      // without re-picking a file doesn't wipe out a document it already has.
      aadharFrontImageUrl: buildFileUrl(files, "aadharFrontFile") ?? undefined,
      aadharBackImageUrl: buildFileUrl(files, "aadharBackFile") ?? undefined,
      panFrontImageUrl: buildFileUrl(files, "panFrontFile") ?? undefined,
      panBackImageUrl: buildFileUrl(files, "panBackFile") ?? undefined,
      residenceDocUrl: buildFileUrl(files, "residenceFile") ?? undefined
    };

    const result = await upsertDraft(draftId, data);
    if (result.status === "customer_exists") {
      return res.status(400).json({ success: false, message: "A customer with this mobile number is already registered." });
    }

    res.json({ success: true, draftId: result.draft.id });
  } catch (error: any) {
    console.error("Registration Error:", error);
    if (error.code === 'P2002') {
      return res.status(400).json({ success: false, message: "A customer with this mobile number is already registered." });
    }
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function saveDraft(req: Request, res: Response): Promise<any> {
  try {
    const {
      draftId,
      fullName,
      mobileNumber,
      email,
      addressLine1,
      addressLine2,
      city,
      state,
      pincode,
      planDuration,
      houseType,
      residenceDocType
    } = req.body;

    if (!draftId) {
      return res.status(400).json({ success: false, message: "draftId is required" });
    }

    const data = {
      fullName,
      mobileNumber,
      email,
      addressLine1,
      addressLine2,
      city,
      state,
      pincode,
      planDuration: planDuration ? parseInt(planDuration) : undefined,
      houseType,
      residenceDocType
    };

    const result = await upsertDraft(draftId, data);
    if (result.status === "customer_exists") {
      return res.status(409).json({
        success: false,
        code: "CUSTOMER_EXISTS",
        message: "This mobile number is already registered."
      });
    }

    res.json({ success: true, draft: result.draft, resumedDraftId: result.resumedDraftId });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function getDraft(req: Request<{ draftId: string }>, res: Response): Promise<any> {
  try {
    const draft = await prisma.customerDraft.findUnique({ where: { id: req.params.draftId } });
    if (!draft) {
      return res.status(404).json({ success: false, message: "Draft not found" });
    }
    res.json({ success: true, draft });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

// Lets the registration form auto-resume an in-progress draft as soon as the
// customer types their mobile number, even without a `?draft=<id>` link.
export async function getDraftByMobile(req: Request<{ mobileNumber: string }>, res: Response): Promise<any> {
  try {
    const draft = await prisma.customerDraft.findUnique({ where: { mobileNumber: req.params.mobileNumber } });
    if (!draft) {
      return res.status(404).json({ success: false, message: "Draft not found" });
    }
    res.json({ success: true, draft });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function getCustomerByMobile(req: Request<{ mobileNumber: string }>, res: Response): Promise<any> {
  try {
    const { mobileNumber } = req.params;
    const mobileWithoutCode = mobileNumber.replace(/^\+91/, "");

    const customer = await prisma.customer.findFirst({
      where: {
        OR: [
          { mobileNumber: mobileNumber },
          { mobileNumber: mobileWithoutCode },
          { mobileNumber: `+91${mobileWithoutCode}` }
        ]
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    res.json({ success: true, customer });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function requestReturn(req: Request, res: Response): Promise<any> {
  try {
    const { customerId } = req.body;

    if (!customerId) {
      return res.status(400).json({ success: false, message: "customerId is required" });
    }

    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    if (customer.subscriptionStatus !== "ACTIVE") {
      return res.status(400).json({ success: false, message: "No active subscription to discontinue" });
    }

    const updated = await prisma.customer.update({
      where: { id: customerId },
      data: {
        subscriptionStatus: "CANCELLED",
        returnRequested: true,
        returnRequestedAt: new Date(),
        // A completed advance payment becomes refundable once the product is being returned;
        // the admin fixes the final refundAmount after the technician reports its condition.
        ...(customer.paymentStatus === "COMPLETED" ? { paymentStatus: "PENDING_REFUND" } : {})
      }
    });

    res.json({ success: true, customer: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

// Final step of the close-agreement flow: only usable once the admin has inspected the
// returned product and fixed a refundAmount. The customer just confirms that fixed number.
export async function closeAccount(req: Request, res: Response): Promise<any> {
  try {
    const { customerId } = req.body;

    if (!customerId) {
      return res.status(400).json({ success: false, message: "customerId is required" });
    }

    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    if (customer.paymentStatus !== "PENDING_REFUND") {
      return res.status(400).json({ success: false, message: "No pending refund found for this account" });
    }

    if (customer.refundAmount === null) {
      return res.status(400).json({ success: false, message: "Refund amount has not been finalized yet" });
    }

    const updated = await prisma.customer.update({
      where: { id: customerId },
      data: { paymentStatus: "REFUNDED" }
    });

    const invoice = await createInvoice({
      type: "REFUND",
      customerId,
      productType: "Security Deposit Refund",
      amount: customer.refundAmount,
      paymentMethod: "Manual",
      status: "REFUNDED",
      reason: "Refund of security deposit following product return"
    });

    res.json({ success: true, customer: updated, invoiceId: invoice.id });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}
