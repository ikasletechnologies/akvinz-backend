"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const compression_1 = __importDefault(require("compression"));
const morgan_1 = __importDefault(require("morgan"));
const env_1 = require("./config/env");
const routes_1 = __importDefault(require("./routes"));
const webhook_controller_1 = require("./controllers/webhook.controller");
const app = (0, express_1.default)();
app.use((0, cors_1.default)({ origin: env_1.env.corsOrigin }));
app.use((0, helmet_1.default)());
app.use((0, compression_1.default)());
app.use((0, morgan_1.default)("dev"));
// Registered ahead of express.json() with a raw-body parser: Razorpay's
// webhook signature is an HMAC over the exact request bytes, which the JSON
// parser would otherwise consume and reserialize (breaking the signature).
app.post("/api/webhooks/razorpay", express_1.default.raw({ type: "application/json" }), webhook_controller_1.razorpayWebhook);
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
app.use("/uploads", express_1.default.static(env_1.env.uploadDir));
app.use("/api", routes_1.default);
exports.default = app;
//# sourceMappingURL=app.js.map