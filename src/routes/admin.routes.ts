import { Router } from "express";
import { requireAdmin } from "../middlewares/requireAdmin";
import { upload } from "../middlewares/upload.middleware";
import { login, getStats, listCustomers, createCustomer, getCustomer, getCustomerUpiVpa, updateCustomer, deleteCustomer, uploadCustomerDocuments, deleteCustomerDocument, listDrafts, deleteDraft, triggerRenewals, createPaymentLink, listCustomerPaymentLinks, markPaymentLinkAsPaid, changePlan, createPayout, listCustomerPayouts, refundNow, refundPlanChangeViaRazorpay, requestRefundOtp, verifyRefundOtpAndExecute, cancelRefundOtp, requestPayoutOtp, verifyPayoutOtpAndExecute, cancelPayout, getCustomerMoneyTransactions } from "../controllers/admin.controller";
import { downloadInvoicePdf, listCustomerInvoices } from "../controllers/invoice.controller";
import { listReturnEvents, createReturnEvent } from "../controllers/returnProcess.controller";
import { listLocationChangeRequests, reviewLocationChangeRequest } from "../controllers/locationChange.controller";

const router = Router();

router.post("/admin/login", login);
router.get("/admin/stats", requireAdmin, getStats);
router.get("/admin/customers", requireAdmin, listCustomers);
router.post(
  "/admin/customers",
  requireAdmin,
  upload.fields([
    { name: "aadharFrontFile", maxCount: 1 },
    { name: "aadharBackFile", maxCount: 1 },
    { name: "panFrontFile", maxCount: 1 },
    { name: "panBackFile", maxCount: 1 },
    { name: "residenceFile", maxCount: 1 }
  ]),
  createCustomer
);
router.get("/admin/customers/:id", requireAdmin, getCustomer);
router.get("/admin/customers/:id/upi-vpa", requireAdmin, getCustomerUpiVpa);
router.patch("/admin/customers/:id", requireAdmin, updateCustomer);
router.delete("/admin/customers/:id", requireAdmin, deleteCustomer);
router.post(
  "/admin/customers/:id/documents",
  requireAdmin,
  upload.fields([
    { name: "aadharFrontFile", maxCount: 1 },
    { name: "aadharBackFile", maxCount: 1 },
    { name: "panFrontFile", maxCount: 1 },
    { name: "panBackFile", maxCount: 1 },
    { name: "residenceFile", maxCount: 1 },
    { name: "planChangeRefundProofFile", maxCount: 1 }
  ]),
  uploadCustomerDocuments
);
router.delete("/admin/customers/:id/documents/:field", requireAdmin, deleteCustomerDocument);
router.get("/admin/drafts", requireAdmin, listDrafts);
router.delete("/admin/drafts/:id", requireAdmin, deleteDraft);
router.post("/admin/process-renewals", requireAdmin, triggerRenewals);
router.post("/admin/customers/:id/payment-link", requireAdmin, createPaymentLink);
router.get("/admin/customers/:id/payment-links", requireAdmin, listCustomerPaymentLinks);
router.post("/admin/payment-links/:linkId/mark-paid", requireAdmin, markPaymentLinkAsPaid);
router.post(
  "/admin/customers/:id/payout",
  requireAdmin,
  upload.fields([{ name: "proofFile", maxCount: 1 }]),
  createPayout
);
router.get("/admin/customers/:id/payouts", requireAdmin, listCustomerPayouts);
router.post("/admin/customers/:id/refund-now", requireAdmin, refundNow);
router.post("/admin/customers/:id/change-plan", requireAdmin, changePlan);
router.post("/admin/customers/:id/plan-change-refund", requireAdmin, refundPlanChangeViaRazorpay);
router.post("/admin/customers/:id/plan-change/refund/request-otp", requireAdmin, requestRefundOtp);
router.post("/admin/customers/:id/plan-change/refund/verify-otp", requireAdmin, verifyRefundOtpAndExecute);
router.post("/admin/customers/:id/plan-change/refund/cancel", requireAdmin, cancelRefundOtp);
router.post("/admin/customers/:id/money-transactions/payout/request-otp", requireAdmin, requestPayoutOtp);
router.post("/admin/money-transactions/payout/verify-otp", requireAdmin, verifyPayoutOtpAndExecute);
router.post("/admin/money-transactions/payout/cancel", requireAdmin, cancelPayout);
router.get("/admin/customers/:id/money-transactions", requireAdmin, getCustomerMoneyTransactions);
router.get("/admin/customers/:id/invoices", requireAdmin, listCustomerInvoices);
router.get("/admin/invoices/:invoiceId/pdf", requireAdmin, downloadInvoicePdf);
router.get("/admin/customers/:id/return-events", requireAdmin, listReturnEvents);
router.post(
  "/admin/customers/:id/return-events",
  requireAdmin,
  upload.fields([{ name: "defectImages", maxCount: 3 }]),
  createReturnEvent
);
router.get("/admin/location-change-requests", requireAdmin, listLocationChangeRequests);
router.post("/admin/location-change-requests/:id/review", requireAdmin, reviewLocationChangeRequest);

export default router;
