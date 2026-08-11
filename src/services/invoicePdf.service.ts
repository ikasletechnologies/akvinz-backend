import PDFDocument from "pdfkit";
import sharp from "sharp";
import path from "path";
import { Customer, Invoice } from "@prisma/client";
import { company } from "../config/company";

const LOGO_PATH = path.join(__dirname, "..", "assets", "logo.svg");

let logoPngPromise: Promise<Buffer> | null = null;
function getLogoPng(): Promise<Buffer> {
  if (!logoPngPromise) {
    logoPngPromise = sharp(LOGO_PATH, { density: 300 }).resize({ height: 200 }).png().toBuffer();
  }
  return logoPngPromise;
}

const STATUS_COLORS: Record<string, string> = {
  FUNDED: "#16a34a",
  REFUNDED: "#2563eb"
};

// pdfkit's built-in Helvetica only supports WinAnsiEncoding, which has no
// Rupee sign (U+20B9) glyph — it renders as a garbled superscript instead of
// silently failing. Suffixing "INR" (as the reference receipt does) avoids
// needing to embed a custom Unicode font just for one symbol.
function formatINR(amount: number): string {
  return `${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)} INR`;
}

function formatDate(date: Date): string {
  return date.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata"
  });
}

export async function renderInvoicePdf(invoice: Invoice, customer: Customer): Promise<Buffer> {
  const logoPng = await getLogoPng();

  const doc = new PDFDocument({ size: "A4", margin: 50 });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const pageWidth = doc.page.width;
  const margin = doc.page.margins.left;
  const contentWidth = pageWidth - margin * 2;

  // Header band
  const headerHeight = 90;
  doc.rect(0, 0, pageWidth, headerHeight).fill("#131724");
  const logoHeight = 30;
  const logoWidth = (200 / 200) * logoHeight * (260 / 48); // logo viewBox is 260x48
  doc.image(logoPng, pageWidth - margin - logoWidth, (headerHeight - logoHeight) / 2, { height: logoHeight });

  // Title block. Measure the title's actual wrapped height instead of
  // assuming one line, since "Rent O Mate By Akvinz — Payment Receipt for
  // {name}" can run long enough to wrap depending on the customer's name.
  let y = headerHeight + 30;
  const titleText = `Rent O Mate By Akvinz — Payment Receipt for ${customer.fullName}`;
  doc.font("Helvetica-Bold").fontSize(18);
  const titleHeight = doc.heightOfString(titleText, { width: contentWidth });
  doc.fillColor("#111827").text(titleText, margin, y, { width: contentWidth });
  y += titleHeight + 10;
  doc.fillColor("#f26522").font("Helvetica-Bold").fontSize(11).text(`Receipt Number: ${invoice.billNumber}`, margin, y);
  y += 16;
  doc.fillColor("#6b7280").font("Helvetica").fontSize(9).text(`Account ID: ${customer.id}`, margin, y);
  y += 24;

  doc.moveTo(margin, y).lineTo(pageWidth - margin, y).strokeColor("#e5e7eb").lineWidth(1).stroke();
  y += 30;

  const leftX = margin;
  const rightColWidth = 220;
  const rightX = pageWidth - margin - rightColWidth;

  const field = (x: number, yPos: number, label: string, value: string, width: number, align: "left" | "right" = "left") => {
    doc.fillColor("#6b7280").font("Helvetica").fontSize(9).text(label, x, yPos, { width, align });
    doc.fillColor("#111827").font("Helvetica-Bold").fontSize(11).text(value, x, yPos + 13, { width, align });
  };

  const leftStartY = y;
  field(leftX, y, "Document Date", formatDate(invoice.documentDate), 280);
  y += 44;
  field(leftX, y, "Payment method", invoice.paymentMethod, 280);
  y += 44;
  field(leftX, y, "Transaction ID", invoice.transactionId || "N/A", 280);
  y += 44;
  field(leftX, y, "Product Type", invoice.productType, 280);
  y += 44;
  const subscriptionMonths = customer.rentalPlanDuration ?? customer.planDuration;
  field(leftX, y, "Subscription duration", subscriptionMonths ? `${subscriptionMonths} Months` : "N/A", 280);

  // Right column: status, amount, reason
  let ry = leftStartY;
  const statusColor = STATUS_COLORS[invoice.status] || "#6b7280";
  doc.fillColor(statusColor).font("Helvetica-Bold").fontSize(11).text(invoice.status === "FUNDED" ? "Funded" : invoice.status === "REFUNDED" ? "Refunded" : invoice.status, rightX, ry, { width: rightColWidth, align: "right" });
  ry += 20;
  doc.fillColor("#111827").font("Helvetica-Bold").fontSize(26).text(formatINR(invoice.amount), rightX, ry, { width: rightColWidth, align: "right" });
  ry += 40;
  doc.fillColor("#9ca3af").font("Helvetica").fontSize(9).text(invoice.reason || "No reason available.", rightX, ry, { width: rightColWidth, align: "right" });

  // Footer — kept well clear of the bottom margin so pdfkit never
  // auto-paginates the last line onto a spurious second page.
  const footerY = doc.page.height - 160;
  doc.moveTo(margin, footerY).lineTo(pageWidth - margin, footerY).strokeColor("#e5e7eb").lineWidth(1).stroke();

  doc.fillColor("#6b7280").font("Helvetica").fontSize(8);
  let fy = footerY + 14;
  doc.text(company.legalName, margin, fy);
  fy += 12;
  company.address.forEach((line) => {
    doc.text(line, margin, fy);
    fy += 12;
  });
  doc.text(`GSTIN: ${company.gstin}`, margin, fy);

  let cfy = footerY + 14;
  const contactX = pageWidth - margin - 220;
  doc.text(`Email: ${company.email}`, contactX, cfy, { width: 220, align: "right" });
  cfy += 12;
  doc.text(`Support: ${company.supportEmail}`, contactX, cfy, { width: 220, align: "right" });
  cfy += 12;
  doc.text(`Website: ${company.website}`, contactX, cfy, { width: 220, align: "right" });
  cfy += 12;
  doc.text(`WhatsApp: ${company.whatsapp}`, contactX, cfy, { width: 220, align: "right" });

  doc.end();
  return done;
}
