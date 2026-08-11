import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { processRenewals } from "../services/billing.service";

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

export async function getStats(req: Request, res: Response): Promise<any> {
  try {
    const [totalCustomers, activeSubscriptions, pendingPayments, completedPayments, totalReturns, pendingRefunds, revenueAgg] = await Promise.all([
      prisma.customer.count(),
      prisma.customer.count({ where: { subscriptionStatus: "ACTIVE" } }),
      prisma.customer.count({ where: { paymentStatus: "PENDING" } }),
      prisma.customer.count({ where: { paymentStatus: "COMPLETED" } }),
      prisma.customer.count({ where: { returnRequested: true } }),
      prisma.customer.count({ where: { paymentStatus: "PENDING_REFUND" } }),
      prisma.customer.aggregate({ _sum: { rentalAmount: true } })
    ]);

    res.json({
      success: true,
      stats: {
        totalCustomers,
        activeSubscriptions,
        pendingPayments,
        completedPayments,
        totalReturns,
        pendingRefunds,
        totalRentalRevenue: revenueAgg._sum.rentalAmount || 0
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
  try {
    await prisma.customer.delete({ where: { id: req.params.id as string } });
    res.json({ success: true, message: "Customer deleted" });
  } catch (error: any) {
    if (error.code === "P2025") {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }
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
