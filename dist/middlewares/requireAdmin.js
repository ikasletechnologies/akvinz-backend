"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAdmin = requireAdmin;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const env_1 = require("../config/env");
function requireAdmin(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    try {
        jsonwebtoken_1.default.verify(token, env_1.env.admin.jwtSecret);
        next();
    }
    catch (error) {
        return res.status(401).json({ success: false, message: "Invalid or expired token" });
    }
}
//# sourceMappingURL=requireAdmin.js.map