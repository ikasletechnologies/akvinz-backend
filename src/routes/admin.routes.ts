import { Router } from "express";
import { requireAdmin } from "../middlewares/requireAdmin";
import { upload } from "../middlewares/upload.middleware";
import { login, getStats, listCustomers, getCustomer, updateCustomer, deleteCustomer, listDrafts, deleteDraft, triggerRenewals, createPaymentLink, listCustomerPaymentLinks, markPaymentLinkAsPaid, changePlan } from "../controllers/admin.controller";
import { downloadInvoicePdf, listCustomerInvoices } from "../controllers/invoice.controller";
import { listReturnEvents, createReturnEvent } from "../controllers/returnProcess.controller";

const router = Router();

router.post("/admin/login", login);
router.get("/admin/stats", requireAdmin, getStats);
router.get("/admin/customers", requireAdmin, listCustomers);
router.get("/admin/customers/:id", requireAdmin, getCustomer);
router.patch("/admin/customers/:id", requireAdmin, updateCustomer);
router.delete("/admin/customers/:id", requireAdmin, deleteCustomer);
router.get("/admin/drafts", requireAdmin, listDrafts);
router.delete("/admin/drafts/:id", requireAdmin, deleteDraft);
router.post("/admin/process-renewals", requireAdmin, triggerRenewals);
router.post("/admin/customers/:id/payment-link", requireAdmin, createPaymentLink);
router.get("/admin/customers/:id/payment-links", requireAdmin, listCustomerPaymentLinks);
router.post("/admin/payment-links/:linkId/mark-paid", requireAdmin, markPaymentLinkAsPaid);
router.post("/admin/customers/:id/change-plan", requireAdmin, changePlan);
router.get("/admin/customers/:id/invoices", requireAdmin, listCustomerInvoices);
router.get("/admin/invoices/:invoiceId/pdf", requireAdmin, downloadInvoicePdf);
router.get("/admin/customers/:id/return-events", requireAdmin, listReturnEvents);
router.post(
  "/admin/customers/:id/return-events",
  requireAdmin,
  upload.fields([{ name: "defectImages", maxCount: 3 }]),
  createReturnEvent
);

export default router;
