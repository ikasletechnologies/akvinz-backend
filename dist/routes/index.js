"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const otp_routes_1 = __importDefault(require("./otp.routes"));
const customer_routes_1 = __importDefault(require("./customer.routes"));
const payment_routes_1 = __importDefault(require("./payment.routes"));
const admin_routes_1 = __importDefault(require("./admin.routes"));
const router = (0, express_1.Router)();
router.use(otp_routes_1.default);
router.use(customer_routes_1.default);
router.use(payment_routes_1.default);
router.use(admin_routes_1.default);
exports.default = router;
//# sourceMappingURL=index.js.map