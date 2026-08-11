import { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { buildFileUrl } from "../utils/fileUrl";
import { createInvoice } from "../services/invoice.service";

export async function register(req: Request, res: Response): Promise<any> {
  try {
    const {
      fullName,
      mobileNumber,
      email,
      addressLine1,
      addressLine2,
      city,
      state,
      pincode,
      planDuration,
      houseType
    } = req.body;

    const files = req.files as { [fieldname: string]: Express.Multer.File[] };

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
        aadharFrontImageUrl: buildFileUrl(files, "aadharFrontFile"),
        aadharBackImageUrl: buildFileUrl(files, "aadharBackFile"),
        panFrontImageUrl: buildFileUrl(files, "panFrontFile"),
        panBackImageUrl: buildFileUrl(files, "panBackFile"),
        residenceDocUrl: buildFileUrl(files, "residenceFile"),
        paymentStatus: "PENDING"
      }
    });

    res.json({ success: true, customerId: customer.id });
  } catch (error: any) {
    console.error("Registration Error:", error);
    if (error.code === 'P2002') {
      return res.status(400).json({ success: false, message: "A user with this email already exists." });
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

    const draft = await prisma.customerDraft.upsert({
      where: { id: draftId },
      update: data,
      create: { id: draftId, ...data }
    });

    res.json({ success: true, draft });
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
