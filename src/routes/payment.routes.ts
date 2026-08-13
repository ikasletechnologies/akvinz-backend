import { Router } from "express";
import { createOrder, verifyPayment, verifyRentalPayment, setupAutopay, verifyAutopaySetup } from "../controllers/payment.controller";

const router = Router();

router.post("/create-order", createOrder);
router.post("/verify-payment", verifyPayment);
router.post("/verify-rental-payment", verifyRentalPayment);
router.post("/subscription/autopay/setup", setupAutopay);
router.post("/subscription/autopay/verify", verifyAutopaySetup);

export default router;
