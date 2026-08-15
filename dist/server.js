"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const node_cron_1 = __importDefault(require("node-cron"));
const app_1 = __importDefault(require("./app"));
const billing_service_1 = require("./services/billing.service");
const PORT = process.env.PORT || 5000;
app_1.default.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});
// Runs daily at 00:15 — flips ACTIVE subscriptions whose current billing
// period has ended to PENDING_DUE, anchored to each customer's billingDay.
node_cron_1.default.schedule("15 0 * * *", async () => {
    try {
        const result = await (0, billing_service_1.processRenewals)();
        console.log(`[billing] renewal sweep: checked=${result.checked} pendingDue=${result.pendingDue} completed=${result.completed}`);
    }
    catch (error) {
        console.error("[billing] renewal sweep failed", error);
    }
});
//# sourceMappingURL=server.js.map