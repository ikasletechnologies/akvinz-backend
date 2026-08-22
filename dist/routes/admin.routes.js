"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const requireAdmin_1 = require("../middlewares/requireAdmin");
const upload_middleware_1 = require("../middlewares/upload.middleware");
const admin_controller_1 = require("../controllers/admin.controller");
const invoice_controller_1 = require("../controllers/invoice.controller");
const returnProcess_controller_1 = require("../controllers/returnProcess.controller");
const locationChange_controller_1 = require("../controllers/locationChange.controller");
const router = (0, express_1.Router)();
router.post("/admin/login", admin_controller_1.login);
router.get("/admin/stats", requireAdmin_1.requireAdmin, admin_controller_1.getStats);
router.get("/admin/customers", requireAdmin_1.requireAdmin, admin_controller_1.listCustomers);
router.post("/admin/customers", requireAdmin_1.requireAdmin, upload_middleware_1.upload.fields([
    { name: "aadharFrontFile", maxCount: 1 },
    { name: "aadharBackFile", maxCount: 1 },
    { name: "panFrontFile", maxCount: 1 },
    { name: "panBackFile", maxCount: 1 },
    { name: "residenceFile", maxCount: 1 }
]), admin_controller_1.createCustomer);
router.get("/admin/customers/:id", requireAdmin_1.requireAdmin, admin_controller_1.getCustomer);
router.get("/admin/customers/:id/upi-vpa", requireAdmin_1.requireAdmin, admin_controller_1.getCustomerUpiVpa);
router.patch("/admin/customers/:id", requireAdmin_1.requireAdmin, admin_controller_1.updateCustomer);
router.delete("/admin/customers/:id", requireAdmin_1.requireAdmin, admin_controller_1.deleteCustomer);
router.post("/admin/customers/:id/documents", requireAdmin_1.requireAdmin, upload_middleware_1.upload.fields([
    { name: "aadharFrontFile", maxCount: 1 },
    { name: "aadharBackFile", maxCount: 1 },
    { name: "panFrontFile", maxCount: 1 },
    { name: "panBackFile", maxCount: 1 },
    { name: "residenceFile", maxCount: 1 },
    { name: "planChangeRefundProofFile", maxCount: 1 }
]), admin_controller_1.uploadCustomerDocuments);
router.delete("/admin/customers/:id/documents/:field", requireAdmin_1.requireAdmin, admin_controller_1.deleteCustomerDocument);
router.get("/admin/drafts", requireAdmin_1.requireAdmin, admin_controller_1.listDrafts);
router.delete("/admin/drafts/:id", requireAdmin_1.requireAdmin, admin_controller_1.deleteDraft);
router.post("/admin/process-renewals", requireAdmin_1.requireAdmin, admin_controller_1.triggerRenewals);
router.post("/admin/customers/:id/payment-link", requireAdmin_1.requireAdmin, admin_controller_1.createPaymentLink);
router.get("/admin/customers/:id/payment-links", requireAdmin_1.requireAdmin, admin_controller_1.listCustomerPaymentLinks);
router.post("/admin/customers/:id/payment-links/sync", requireAdmin_1.requireAdmin, admin_controller_1.syncCustomerPaymentLinksEndpoint);
router.post("/admin/payment-links/:linkId/mark-paid", requireAdmin_1.requireAdmin, admin_controller_1.markPaymentLinkAsPaid);
router.post("/admin/customers/:id/payout", requireAdmin_1.requireAdmin, upload_middleware_1.upload.fields([{ name: "proofFile", maxCount: 1 }]), admin_controller_1.createPayout);
router.get("/admin/customers/:id/payouts", requireAdmin_1.requireAdmin, admin_controller_1.listCustomerPayouts);
router.post("/admin/customers/:id/refund-now", requireAdmin_1.requireAdmin, admin_controller_1.refundNow);
router.post("/admin/customers/:id/change-plan", requireAdmin_1.requireAdmin, admin_controller_1.changePlan);
router.post("/admin/customers/:id/plan-change-refund", requireAdmin_1.requireAdmin, admin_controller_1.refundPlanChangeViaRazorpay);
router.post("/admin/customers/:id/plan-change/refund/request-otp", requireAdmin_1.requireAdmin, admin_controller_1.requestRefundOtp);
router.post("/admin/customers/:id/plan-change/refund/verify-otp", requireAdmin_1.requireAdmin, admin_controller_1.verifyRefundOtpAndExecute);
router.post("/admin/customers/:id/plan-change/refund/cancel", requireAdmin_1.requireAdmin, admin_controller_1.cancelRefundOtp);
router.post("/admin/customers/:id/money-transactions/payout/request-otp", requireAdmin_1.requireAdmin, admin_controller_1.requestPayoutOtp);
router.post("/admin/money-transactions/payout/verify-otp", requireAdmin_1.requireAdmin, admin_controller_1.verifyPayoutOtpAndExecute);
router.post("/admin/money-transactions/payout/cancel", requireAdmin_1.requireAdmin, admin_controller_1.cancelPayout);
router.get("/admin/customers/:id/money-transactions", requireAdmin_1.requireAdmin, admin_controller_1.getCustomerMoneyTransactions);
router.get("/admin/customers/:id/invoices", requireAdmin_1.requireAdmin, invoice_controller_1.listCustomerInvoices);
router.get("/admin/invoices/:invoiceId/pdf", requireAdmin_1.requireAdmin, invoice_controller_1.downloadInvoicePdf);
router.get("/admin/customers/:id/return-events", requireAdmin_1.requireAdmin, returnProcess_controller_1.listReturnEvents);
router.post("/admin/customers/:id/return-events", requireAdmin_1.requireAdmin, upload_middleware_1.upload.fields([{ name: "defectImages", maxCount: 3 }]), returnProcess_controller_1.createReturnEvent);
router.get("/admin/location-change-requests", requireAdmin_1.requireAdmin, locationChange_controller_1.listLocationChangeRequests);
router.post("/admin/location-change-requests/:id/review", requireAdmin_1.requireAdmin, locationChange_controller_1.reviewLocationChangeRequest);
exports.default = router;
//# sourceMappingURL=admin.routes.js.map