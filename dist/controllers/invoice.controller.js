"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadInvoicePdf = downloadInvoicePdf;
exports.downloadCustomerInvoicePdf = downloadCustomerInvoicePdf;
exports.listCustomerInvoices = listCustomerInvoices;
const prisma_1 = require("../config/prisma");
const invoicePdf_service_1 = require("../services/invoicePdf.service");
async function sendInvoicePdf(res, invoice) {
    const pdf = await (0, invoicePdf_service_1.renderInvoicePdf)(invoice, invoice.customer);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${invoice.billNumber}.pdf"`);
    res.send(pdf);
}
async function downloadInvoicePdf(req, res) {
    try {
        const invoice = await prisma_1.prisma.invoice.findUnique({ where: { id: req.params.invoiceId }, include: { customer: true } });
        if (!invoice) {
            return res.status(404).json({ success: false, message: "Invoice not found" });
        }
        await sendInvoicePdf(res, invoice);
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}
async function downloadCustomerInvoicePdf(req, res) {
    try {
        const invoice = await prisma_1.prisma.invoice.findUnique({ where: { id: req.params.invoiceId }, include: { customer: true } });
        if (!invoice || invoice.customerId !== req.params.customerId) {
            return res.status(404).json({ success: false, message: "Invoice not found" });
        }
        await sendInvoicePdf(res, invoice);
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}
async function listCustomerInvoices(req, res) {
    try {
        const invoices = await prisma_1.prisma.invoice.findMany({
            where: { customerId: req.params.id },
            orderBy: { createdAt: "desc" }
        });
        res.json({ success: true, invoices });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}
//# sourceMappingURL=invoice.controller.js.map