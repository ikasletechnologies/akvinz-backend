import { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { buildFileUrls } from "../utils/fileUrl";

export const RETURN_STEPS = [
  "DEINITIALIZATION_INITIATED",
  "DEFECT_REPORTED",
  "MACHINE_COLLECTED",
  "MACHINE_RECEIVED_WAREHOUSE",
  "REFUND_INITIATED",
  "PAYMENT_REFUNDED"
] as const;

const STEP_STATUSES: Record<string, string[]> = {
  DEINITIALIZATION_INITIATED: ["PENDING", "COMPLETED"],
  DEFECT_REPORTED: ["YES", "NO"],
  MACHINE_COLLECTED: ["PENDING", "COMPLETED"],
  MACHINE_RECEIVED_WAREHOUSE: ["PENDING", "COMPLETED"],
  REFUND_INITIATED: ["PENDING", "COMPLETED"],
  PAYMENT_REFUNDED: ["PENDING", "COMPLETED"]
};

export async function listReturnEvents(req: Request<{ id: string }>, res: Response): Promise<any> {
  try {
    const events = await prisma.returnProcessEvent.findMany({
      where: { customerId: req.params.id },
      orderBy: { createdAt: "desc" }
    });
    res.json({ success: true, events });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function createReturnEvent(req: Request<{ id: string }>, res: Response): Promise<any> {
  try {
    const { step, status, eventDate, remarks } = req.body;

    if (!(RETURN_STEPS as readonly string[]).includes(step)) {
      return res.status(400).json({ success: false, message: "Invalid step" });
    }
    if (!STEP_STATUSES[step].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status for this step" });
    }
    if (step === "DEFECT_REPORTED" && status === "YES" && !remarks?.trim()) {
      return res.status(400).json({ success: false, message: "Remarks are required when a defect is reported" });
    }
    if (!eventDate) {
      return res.status(400).json({ success: false, message: "eventDate is required" });
    }

    const customer = await prisma.customer.findUnique({ where: { id: req.params.id } });
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const defectImageUrls = step === "DEFECT_REPORTED" && status === "YES" && files
      ? buildFileUrls(files, "defectImages")
      : [];

    const event = await prisma.returnProcessEvent.create({
      data: {
        customerId: req.params.id,
        step,
        status,
        eventDate: new Date(eventDate),
        remarks: remarks?.trim() || null,
        defectImageUrls
      }
    });

    res.json({ success: true, event });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}
