import { Router } from "express";
import otpRoutes from "./otp.routes";
import customerRoutes from "./customer.routes";
import paymentRoutes from "./payment.routes";
import adminRoutes from "./admin.routes";

const router = Router();

router.use(otpRoutes);
router.use(customerRoutes);
router.use(paymentRoutes);
router.use(adminRoutes);

export default router;
