"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const upload_middleware_1 = require("../middlewares/upload.middleware");
const customer_controller_1 = require("../controllers/customer.controller");
const invoice_controller_1 = require("../controllers/invoice.controller");
const locationChange_controller_1 = require("../controllers/locationChange.controller");
const router = (0, express_1.Router)();
router.post("/register", upload_middleware_1.upload.fields([
    { name: "aadharFrontFile", maxCount: 1 },
    { name: "aadharBackFile", maxCount: 1 },
    { name: "panFrontFile", maxCount: 1 },
    { name: "panBackFile", maxCount: 1 },
    { name: "residenceFile", maxCount: 1 }
]), customer_controller_1.register);
router.post("/customer/draft", customer_controller_1.saveDraft);
router.get("/customer/draft/by-mobile/:mobileNumber", customer_controller_1.getDraftByMobile);
router.get("/customer/draft/:draftId", customer_controller_1.getDraft);
router.get("/customer/:customerId/invoices/:invoiceId/pdf", invoice_controller_1.downloadCustomerInvoicePdf);
router.get("/customer/:mobileNumber", customer_controller_1.getCustomerByMobile);
router.post("/subscription/return", customer_controller_1.requestReturn);
router.post("/account/close", customer_controller_1.closeAccount);
router.post("/account/bank-details", customer_controller_1.updateBankDetails);
router.post("/customer/location-change", upload_middleware_1.upload.fields([{ name: "proofDocument", maxCount: 1 }]), locationChange_controller_1.submitLocationChange);
exports.default = router;
//# sourceMappingURL=customer.routes.js.map