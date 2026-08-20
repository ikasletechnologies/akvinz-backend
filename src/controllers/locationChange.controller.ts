import { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { buildFileUrl } from "../utils/fileUrl";

export async function submitLocationChange(req: Request, res: Response): Promise<any> {
  try {
    const {
      customerId,
      newFullAddress,
      newCity,
      newDistrict,
      newState,
      newPincode,
      newResidenceStatus,
      proofType,
      reason,
    } = req.body;

    if (!customerId) {
      return res.status(400).json({ success: false, message: "customerId is required" });
    }

    if (!newFullAddress || !newCity || !newDistrict || !newState || !newPincode || !newResidenceStatus || !proofType || !reason) {
      return res.status(400).json({ success: false, message: "All fields are required" });
    }

    const customer = await prisma.customer.findUnique({
      where: { id: customerId }
    });

    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const proofDocUrl = files ? buildFileUrl(files, "proofDocument") : null;

    if (!proofDocUrl) {
      return res.status(400).json({ success: false, message: "Proof document is required" });
    }

    // Capture old address from customer record
    const oldFullAddress = [customer.addressLine1, customer.addressLine2].filter(Boolean).join(", ");
    const oldCity = customer.city;
    const oldDistrict = customer.district || "";
    const oldState = customer.state;
    const oldPincode = customer.pincode;
    const oldResidenceStatus = customer.houseType;

    const request = await prisma.locationChangeRequest.create({
      data: {
        customerId,
        oldFullAddress,
        oldCity,
        oldDistrict,
        oldState,
        oldPincode,
        oldResidenceStatus,
        newFullAddress,
        newCity,
        newDistrict,
        newState,
        newPincode,
        newResidenceStatus,
        proofType,
        proofDocUrl,
        reason,
        status: "PENDING"
      }
    });

    res.json({ success: true, request });
  } catch (error: any) {
    console.error("Submit Location Change Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function listLocationChangeRequests(req: Request, res: Response): Promise<any> {
  try {
    const requests = await prisma.locationChangeRequest.findMany({
      include: {
        customer: {
          select: {
            fullName: true,
            mobileNumber: true
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    res.json({ success: true, requests });
  } catch (error: any) {
    console.error("List Location Change Requests Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function reviewLocationChangeRequest(req: Request, res: Response): Promise<any> {
  try {
    const id = req.params.id as string;
    const { action } = req.body; // "APPROVE" | "REJECT"

    if (action !== "APPROVE" && action !== "REJECT") {
      return res.status(400).json({ success: false, message: "Invalid action. Must be APPROVE or REJECT." });
    }

    const request = await prisma.locationChangeRequest.findUnique({
      where: { id },
      include: { customer: true }
    });

    if (!request) {
      return res.status(404).json({ success: false, message: "Location change request not found" });
    }

    if (request.status !== "PENDING") {
      return res.status(400).json({ success: false, message: "Request has already been reviewed" });
    }

    if (action === "APPROVE") {
      await prisma.$transaction([
        prisma.locationChangeRequest.update({
          where: { id },
          data: { status: "APPROVED" }
        }),
        prisma.customer.update({
          where: { id: request.customerId },
          data: {
            addressLine1: request.newFullAddress,
            addressLine2: null,
            city: request.newCity,
            district: request.newDistrict,
            state: request.newState,
            pincode: request.newPincode,
            houseType: request.newResidenceStatus
          }
        })
      ]);
    } else {
      await prisma.locationChangeRequest.update({
        where: { id },
        data: { status: "REJECTED" }
      });
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error("Review Location Change Request Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
}
