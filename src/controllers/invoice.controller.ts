import { Request, Response } from "express";
import { Customer, Invoice } from "@prisma/client";
import { prisma } from "../config/prisma";
import { renderInvoicePdf } from "../services/invoicePdf.service";

async function sendInvoicePdf(res: Response, invoice: Invoice & { customer: Customer }) {
  const pdf = await renderInvoicePdf(invoice, invoice.customer);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${invoice.billNumber}.pdf"`);
  res.send(pdf);
}

export async function downloadInvoicePdf(req: Request<{ invoiceId: string }>, res: Response): Promise<any> {
  try {
    const invoice = await prisma.invoice.findUnique({ where: { id: req.params.invoiceId }, include: { customer: true } });
    if (!invoice) {
      return res.status(404).json({ success: false, message: "Invoice not found" });
    }
    await sendInvoicePdf(res, invoice);
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function downloadCustomerInvoicePdf(req: Request<{ customerId: string; invoiceId: string }>, res: Response): Promise<any> {
  try {
    const invoice = await prisma.invoice.findUnique({ where: { id: req.params.invoiceId }, include: { customer: true } });
    if (!invoice || invoice.customerId !== req.params.customerId) {
      return res.status(404).json({ success: false, message: "Invoice not found" });
    }
    await sendInvoicePdf(res, invoice);
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function listCustomerInvoices(req: Request<{ id: string }>, res: Response): Promise<any> {
  try {
    const invoices = await prisma.invoice.findMany({
      where: { customerId: req.params.id },
      orderBy: { createdAt: "desc" }
    });
    res.json({ success: true, invoices });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}
