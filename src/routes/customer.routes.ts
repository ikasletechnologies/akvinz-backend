import { Router } from "express";
import { upload } from "../middlewares/upload.middleware";
import { register, getCustomerByMobile, requestReturn, closeAccount, saveDraft, getDraft, getDraftByMobile } from "../controllers/customer.controller";
import { downloadCustomerInvoicePdf } from "../controllers/invoice.controller";

const router = Router();

router.post("/register", upload.fields([
  { name: "aadharFrontFile", maxCount: 1 },
  { name: "aadharBackFile", maxCount: 1 },
  { name: "panFrontFile", maxCount: 1 },
  { name: "panBackFile", maxCount: 1 },
  { name: "residenceFile", maxCount: 1 }
]), register);

router.post("/customer/draft", saveDraft);
router.get("/customer/draft/by-mobile/:mobileNumber", getDraftByMobile);
router.get("/customer/draft/:draftId", getDraft);

router.get("/customer/:customerId/invoices/:invoiceId/pdf", downloadCustomerInvoicePdf);

router.get("/customer/:mobileNumber", getCustomerByMobile);
router.post("/subscription/return", requestReturn);
router.post("/account/close", closeAccount);

export default router;
