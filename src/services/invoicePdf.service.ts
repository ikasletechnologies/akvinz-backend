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

type TermItem = { label: string; text: string };

const SECURITY_DEPOSIT_TERMS: TermItem[] = [
  {
    label: "Security Deposit",
    text: "Refundable subject to the terms of the Principal Subscription Agreement and successful, damage-free retrieval of the product by the Company."
  },
  {
    label: "Monthly Rental",
    text: "Payable in advance as per the selected subscription plan. Charges accrue continuously as long as the product remains installed at the Subscriber's premises."
  },
  {
    label: "Product Ownership",
    text: "The product and all ancillary hardware remain the exclusive property of AKVINZ. The Subscriber obtains only a non-transferable, temporary right to use the asset."
  },
  {
    label: "Product Care & Boundaries",
    text: "The Subscriber must operate the machine strictly according to provided guidelines, ensuring stable power inputs and regular raw water inflow. Internal alterations, housing component breakage, or un-notified relocation will trigger immediate penal liabilities under Section 6 and Section 8 of the Principal Agreement."
  },
  {
    label: "Maintenance & Service",
    text: "Routine maintenance and eligible component replacements are provided exclusively by the Company, subject to the conditions specified in the Subscription Agreement."
  },
  {
    label: "Cancellation & Refund",
    text: "Requires a 30-day prior written notice. The remaining eligible Security Deposit will be processed and refunded within 10 to 15 working days following successful, damage-free product retrieval."
  },
  {
    label: "Agreement Acceptance",
    text: "Payment of this deposit and digital/OTP confirmation of the Subscription Agreement constitutes complete, absolute acceptance of these Terms & Conditions."
  }
];

// Fallback for invoice types that don't have their own tailored wording yet
// (RENTAL, REFUND, PAYMENT_LINK).
const DEFAULT_TERMS: TermItem[] = [
  {
    label: "Security Deposit",
    text: "The Security Deposit is refundable, subject to the terms and conditions of the Subscription Agreement and successful, damage-free product retrieval."
  },
  {
    label: "Monthly Rental",
    text: "The applicable monthly rental amount is payable as per the selected subscription plan and continues while the Product remains installed at the Subscriber's premises."
  },
  {
    label: "Product Ownership",
    text: "The Product remains the exclusive property of AKVINZ. The Subscriber receives only a non-transferable right to use the Product at the registered address."
  },
  {
    label: "Product Care",
    text: "The Subscriber shall not tamper with, modify, dismantle, relocate, or allow unauthorized persons to service or move the Product."
  },
  {
    label: "Maintenance & Service",
    text: "Routine maintenance and eligible component replacements are provided by the Company subject to the conditions specified in the Subscription Agreement."
  },
  {
    label: "Cancellation & Refund",
    text: "Cancellation requires 30 days’ prior notice. The eligible remaining Security Deposit will be refunded within 10 to 15 working days after successful and damage-free product retrieval."
  },
  {
    label: "Agreement Acceptance",
    text: "Payment and digital/OTP acceptance of the Subscription Agreement constitute the Subscriber's acceptance of the applicable Terms & Conditions."
  }
];

function termsForInvoiceType(type: string): TermItem[] {
  return type === "SECURITY_DEPOSIT" ? SECURITY_DEPOSIT_TERMS : DEFAULT_TERMS;
}

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
  const headerHeight = 65;
  doc.rect(0, 0, pageWidth, headerHeight).fill("#131724");
  const logoHeight = 22;
  const logoWidth = (200 / 200) * logoHeight * (260 / 48); // logo viewBox is 260x48
  doc.image(logoPng, pageWidth - margin - logoWidth, (headerHeight - logoHeight) / 2, { height: logoHeight });

  // Title block. Measure the title's actual wrapped height instead of
  // assuming one line, since "Rent O Mate By Akvinz — Payment Receipt for
  // {name}" can run long enough to wrap depending on the customer's name.
  let y = headerHeight + 18;
  const titleText = `Rent O Mate By Akvinz — Payment Receipt for ${customer.fullName}`;
  doc.font("Helvetica-Bold").fontSize(14);
  const titleHeight = doc.heightOfString(titleText, { width: contentWidth });
  doc.fillColor("#111827").text(titleText, margin, y, { width: contentWidth });
  y += titleHeight + 6;
  doc.fillColor("#f26522").font("Helvetica-Bold").fontSize(10).text(`Receipt Number: ${invoice.billNumber}`, margin, y);
  y += 13;
  doc.fillColor("#6b7280").font("Helvetica").fontSize(7.5).text(`Account ID: ${customer.id}`, margin, y);
  y += 15;

  doc.moveTo(margin, y).lineTo(pageWidth - margin, y).strokeColor("#e5e7eb").lineWidth(1).stroke();
  y += 18;

  const leftX = margin;
  const rightColWidth = 220;
  const rightX = pageWidth - margin - rightColWidth;

  const field = (x: number, yPos: number, label: string, value: string, width: number, align: "left" | "right" = "left") => {
    doc.fillColor("#6b7280").font("Helvetica").fontSize(7.5).text(label, x, yPos, { width, align });
    doc.fillColor("#111827").font("Helvetica-Bold").fontSize(9.5).text(value, x, yPos + 11, { width, align });
  };

  const leftStartY = y;
  field(leftX, y, "Document Date", formatDate(invoice.documentDate), 280);
  y += 32;
  field(leftX, y, "Payment method", invoice.paymentMethod, 280);
  y += 32;
  field(leftX, y, "Transaction ID", invoice.transactionId || "N/A", 280);
  y += 32;
  field(leftX, y, "Product Type", invoice.productType, 280);
  y += 32;
  const subscriptionMonths = customer.rentalPlanDuration ?? customer.planDuration;
  field(leftX, y, "Subscription duration", subscriptionMonths ? `${subscriptionMonths} Months` : "N/A", 280);

  // Right column: status, amount, reason
  let ry = leftStartY;
  const statusColor = STATUS_COLORS[invoice.status] || "#6b7280";
  doc.fillColor(statusColor).font("Helvetica-Bold").fontSize(9.5).text(invoice.status === "FUNDED" ? "Funded" : invoice.status === "REFUNDED" ? "Refunded" : invoice.status, rightX, ry, { width: rightColWidth, align: "right" });
  ry += 15;
  doc.fillColor("#111827").font("Helvetica-Bold").fontSize(20).text(formatINR(Number(invoice.amount)), rightX, ry, { width: rightColWidth, align: "right" });
  ry += 28;
  doc.fillColor("#9ca3af").font("Helvetica").fontSize(7.5);
  doc.text(invoice.reason || "No reason available.", rightX, ry, { width: rightColWidth, align: "right" });
  ry += doc.heightOfString(invoice.reason || "No reason available.", { width: rightColWidth });

  // Terms & Conditions — below whichever column (left fields / right
  // amount+reason) ends up taller. Each line's height is measured so the
  // footer below it is always positioned after the real content, never
  // overlapping it regardless of how long the wrapped text runs.
  let ty = Math.max(y + 18, ry) + 16;
  doc.fillColor("#111827").font("Helvetica-Bold").fontSize(9);
  doc.text("Terms & Conditions", margin, ty, { width: contentWidth });
  ty += doc.heightOfString("Terms & Conditions", { width: contentWidth }) + 6;

  // Must mirror the footer's actual layout below exactly (10 gap to the
  // divider + 8 gap to the first line + 9.5 per line for legalName/address
  // lines/GSTIN), otherwise this reserves too little room and the footer
  // silently spills onto an extra near-blank page.
  const footerLines = 1 /* legalName */ + company.address.length + 1 /* GSTIN */;
  const footerHeight = 10 + 8 + footerLines * 9.5;
  const bottomLimit = doc.page.height - doc.page.margins.bottom;

  termsForInvoiceType(invoice.type).forEach(({ label, text }) => {
    // If the next item plus the footer wouldn't fit on this page, start a
    // fresh page rather than letting pdfkit silently clip content past the
    // page boundary.
    const labelText = `${label}:`;
    doc.font("Helvetica-Bold").fontSize(7.5);
    const labelHeight = doc.heightOfString(labelText, { width: contentWidth });
    doc.font("Helvetica").fontSize(7);
    const bodyHeight = doc.heightOfString(text, { width: contentWidth });
    const itemHeight = labelHeight + bodyHeight + 4;

    if (ty + itemHeight + footerHeight > bottomLimit) {
      doc.addPage();
      ty = margin;
    }

    doc.fillColor("#111827").font("Helvetica-Bold").fontSize(7.5).text(labelText, margin, ty, { width: contentWidth });
    ty += labelHeight;
    doc.fillColor("#6b7280").font("Helvetica").fontSize(7).text(text, margin, ty, { width: contentWidth });
    ty += bodyHeight + 4;
  });

  // Footer
  const footerY = ty + 10;
  doc.moveTo(margin, footerY).lineTo(pageWidth - margin, footerY).strokeColor("#e5e7eb").lineWidth(1).stroke();

  doc.fillColor("#6b7280").font("Helvetica").fontSize(7);
  let fy = footerY + 8;
  doc.text(company.legalName, margin, fy);
  fy += 9.5;
  company.address.forEach((line) => {
    doc.text(line, margin, fy);
    fy += 9.5;
  });
  doc.text(`GSTIN: ${company.gstin}`, margin, fy);

  let cfy = footerY + 8;
  const contactX = pageWidth - margin - 220;
  doc.text(`Email: ${company.email}`, contactX, cfy, { width: 220, align: "right" });
  cfy += 9.5;
  doc.text(`Support: ${company.supportEmail}`, contactX, cfy, { width: 220, align: "right" });
  cfy += 9.5;
  doc.text(`Website: ${company.website}`, contactX, cfy, { width: 220, align: "right" });
  cfy += 9.5;
  doc.text(`WhatsApp: ${company.whatsapp}`, contactX, cfy, { width: 220, align: "right" });

  doc.end();
  return done;
}
