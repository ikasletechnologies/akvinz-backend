"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const otp_controller_1 = require("../controllers/otp.controller");
const router = (0, express_1.Router)();
router.post("/send-otp", otp_controller_1.sendOtp);
router.post("/verify-otp", otp_controller_1.verifyOtp);
exports.default = router;
//# sourceMappingURL=otp.routes.js.map