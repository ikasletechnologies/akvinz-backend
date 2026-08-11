"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildFileUrl = buildFileUrl;
exports.buildFileUrls = buildFileUrls;
const env_1 = require("../config/env");
function buildFileUrl(files, field) {
    const filename = files[field]?.[0]?.filename;
    return filename ? `${env_1.env.baseUrl}/uploads/${filename}` : null;
}
function buildFileUrls(files, field) {
    return (files[field] || []).map((f) => `${env_1.env.baseUrl}/uploads/${f.filename}`);
}
//# sourceMappingURL=fileUrl.js.map