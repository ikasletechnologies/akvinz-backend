"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const payment_controller_1 = require("../controllers/payment.controller");
const router = (0, express_1.Router)();
router.post("/create-order", payment_controller_1.createOrder);
router.post("/verify-payment", payment_controller_1.verifyPayment);
router.post("/verify-rental-payment", payment_controller_1.verifyRentalPayment);
exports.default = router;
//# sourceMappingURL=payment.routes.js.map