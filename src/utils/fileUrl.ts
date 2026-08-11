import { env } from "../config/env";

export function buildFileUrl(files: { [fieldname: string]: Express.Multer.File[] }, field: string): string | null {
  const filename = files[field]?.[0]?.filename;
  return filename ? `${env.baseUrl}/uploads/${filename}` : null;
}

export function buildFileUrls(files: { [fieldname: string]: Express.Multer.File[] }, field: string): string[] {
  return (files[field] || []).map((f) => `${env.baseUrl}/uploads/${f.filename}`);
}
