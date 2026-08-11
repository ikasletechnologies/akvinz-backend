"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.twilioClient = void 0;
const twilio_1 = __importDefault(require("twilio"));
const env_1 = require("./env");
exports.twilioClient = (0, twilio_1.default)(env_1.env.twilio.accountSid, env_1.env.twilio.authToken);
//# sourceMappingURL=twilio.js.map