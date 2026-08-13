import dotenv from "dotenv";
dotenv.config();

import cron from "node-cron";
import app from "./app";
import { processRenewals } from "./services/billing.service";

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});

// Runs daily at 00:15 — flips ACTIVE subscriptions whose current billing
// period has ended to PENDING_DUE, anchored to each customer's billingDay.
cron.schedule("15 0 * * *", async () => {
    try {
        const result = await processRenewals();
        console.log(`[billing] renewal sweep: checked=${result.checked} pendingDue=${result.pendingDue} completed=${result.completed}`);
    } catch (error) {
        console.error("[billing] renewal sweep failed", error);
    }
});