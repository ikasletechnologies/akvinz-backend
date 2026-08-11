import twilio from "twilio";
import { env } from "./env";

export const twilioClient = twilio(env.twilio.accountSid, env.twilio.authToken);
