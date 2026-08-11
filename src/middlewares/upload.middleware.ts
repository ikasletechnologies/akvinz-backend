import multer from "multer";
import path from "path";
import fs from "fs";
import { env } from "../config/env";

// Uploaded documents (Aadhar/PAN/residence proof) are stored outside the repo,
// in a folder configured via env so it survives deploys and isn't committed to git.
if (!fs.existsSync(env.uploadDir)) {
  fs.mkdirSync(env.uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, env.uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

export const upload = multer({ storage });
