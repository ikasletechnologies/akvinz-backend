"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.upload = void 0;
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const env_1 = require("../config/env");
// Uploaded documents (Aadhar/PAN/residence proof) are stored outside the repo,
// in a folder configured via env so it survives deploys and isn't committed to git.
if (!fs_1.default.existsSync(env_1.env.uploadDir)) {
    fs_1.default.mkdirSync(env_1.env.uploadDir, { recursive: true });
}
const storage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        cb(null, env_1.env.uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, `${file.fieldname}-${uniqueSuffix}${path_1.default.extname(file.originalname)}`);
    },
});
exports.upload = (0, multer_1.default)({ storage });
//# sourceMappingURL=upload.middleware.js.map