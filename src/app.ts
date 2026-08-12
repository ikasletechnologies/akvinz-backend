import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import morgan from "morgan";
import { env } from "./config/env";
import routes from "./routes";
import { razorpayWebhook } from "./controllers/webhook.controller";

const app = express();

app.use(cors());
app.use(helmet());
app.use(compression());
app.use(morgan("dev"));

// Registered ahead of express.json() with a raw-body parser: Razorpay's
// webhook signature is an HMAC over the exact request bytes, which the JSON
// parser would otherwise consume and reserialize (breaking the signature).
app.post("/api/webhooks/razorpay", express.raw({ type: "application/json" }), razorpayWebhook);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/uploads", express.static(env.uploadDir));

app.use("/api", routes);

export default app;
