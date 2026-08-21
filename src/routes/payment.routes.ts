import { Router } from "express";
import { createOrder, verifyPayment, verifyRentalPayment } from "../controllers/payment.controller";

const router = Router();

router.post("/create-order", createOrder);
router.post("/verify-payment", verifyPayment);
router.post("/verify-rental-payment", verifyRentalPayment);

export default router;
