import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFPage,
  type PDFFont,
} from "pdf-lib";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { TransactionSession } from "../bot/session.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.resolve(
  __dirname,
  "../../forms/templates"
);

type DrawCtx = {
  page: PDFPage;
  font: PDFFont;
  boldFont: PDFFont;
  y: number;
  margin: number;
  width: number;
};

function sanitize(text: string): string {
  return text.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function line(
  ctx: DrawCtx,
  text: string,
  opts: { bold?: boolean; size?: number; indent?: number } = {}
): number {
  const { page, font, boldFont, margin, width } = ctx;
  const f = opts.bold ? boldFont : font;
  const size = opts.size ?? 10;
  const x = margin + (opts.indent ?? 0);
  const maxWidth = width - margin * 2 - (opts.indent ?? 0);
  text = sanitize(text);

  const words = text.split(" ");
  let currentLine = "";
  const lines: string[] = [];

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const testWidth = f.widthOfTextAtSize(testLine, size);
    if (testWidth > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);

  for (const l of lines) {
    page.drawText(l, { x, y: ctx.y, size, font: f, color: rgb(0, 0, 0) });
    ctx.y -= size + 4;
  }

  return ctx.y;
}

function divider(ctx: DrawCtx): void {
  const { page, margin, width } = ctx;
  page.drawLine({
    start: { x: margin, y: ctx.y + 4 },
    end: { x: width - margin, y: ctx.y + 4 },
    thickness: 0.5,
    color: rgb(0.5, 0.5, 0.5),
  });
  ctx.y -= 12;
}

function field(
  ctx: DrawCtx,
  label: string,
  value: string | undefined
): void {
  line(ctx, label, { bold: true, size: 9 });
  line(ctx, value ?? "___________________________", { size: 10, indent: 10 });
  ctx.y -= 4;
}

async function tryLoadTemplate(name: string): Promise<Buffer | null> {
  const p = path.join(TEMPLATES_DIR, name);
  try {
    return fs.readFileSync(p);
  } catch {
    return null;
  }
}

async function fillOrCreatePdf(
  templateName: string,
  fieldMap: Record<string, string>,
  createFn: () => Promise<Uint8Array>
): Promise<Uint8Array> {
  const templateBytes = await tryLoadTemplate(templateName);
  if (templateBytes) {
    try {
      const doc = await PDFDocument.load(templateBytes);
      const form = doc.getForm();
      for (const [key, value] of Object.entries(fieldMap)) {
        try {
          form.getTextField(key).setText(value);
        } catch {
        }
      }
      try {
        form.flatten();
      } catch {
      }
      return doc.save();
    } catch {
    }
  }
  return createFn();
}

export async function generateForm300(
  session: TransactionSession
): Promise<Uint8Array> {
  const buyers = session.buyers;
  const buyerNames = buyers.map((b) => b.name).join(", ");
  const buyerEmails = buyers.map((b) => b.email).join(", ");
  const buyerPhones = buyers.map((b) => b.phone).join(", ");
  const today = new Date().toLocaleDateString("en-CA");

  const fieldMap: Record<string, string> = {
    buyer_name: buyerNames,
    buyer_email: buyerEmails,
    buyer_phone: buyerPhones,
    brokerage_name: session.buyerBrokerageName ?? "",
    agent_name: session.buyerAgentName ?? "",
    date: today,
    property_address: session.propertyAddress ?? "As described by Buyer",
  };

  return fillOrCreatePdf("form300.pdf", fieldMap, async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
    const page = doc.addPage([612, 792]);
    const { width } = page.getSize();
    const margin = 50;
    const ctx: DrawCtx = { page, font, boldFont, y: 750, margin, width };

    line(ctx, "BUYER REPRESENTATION AGREEMENT", { bold: true, size: 14 });
    line(ctx, "Form 300 — Ontario Real Estate Association", { size: 9 });
    ctx.y -= 8;
    divider(ctx);

    line(ctx, "PARTIES", { bold: true, size: 11 });
    ctx.y -= 4;
    field(ctx, "Buyer(s)", buyerNames);
    field(ctx, "Email", buyerEmails);
    field(ctx, "Phone", buyerPhones);
    field(ctx, "Brokerage", session.buyerBrokerageName ?? "");
    field(ctx, "Buyer's Agent", session.buyerAgentName ?? "");
    field(ctx, "Date", today);
    ctx.y -= 6;
    divider(ctx);

    line(ctx, "PROPERTY DESCRIPTION", { bold: true, size: 11 });
    ctx.y -= 4;
    field(ctx, "Property / Area of Interest", session.propertyAddress ?? "Greater Toronto Area");
    ctx.y -= 6;
    divider(ctx);

    line(ctx, "TERMS OF REPRESENTATION", { bold: true, size: 11 });
    ctx.y -= 4;
    line(
      ctx,
      "The Brokerage agrees to act as the exclusive Buyer's agent and to assist the Buyer in finding and purchasing a property.",
      { size: 10 }
    );
    ctx.y -= 8;
    line(
      ctx,
      "The Buyer acknowledges receipt of the RECO Information Guide before signing this Agreement.",
      { size: 10 }
    );
    ctx.y -= 8;
    divider(ctx);

    line(ctx, "RECO INFORMATION GUIDE ACKNOWLEDGMENT", { bold: true, size: 11 });
    ctx.y -= 4;
    line(
      ctx,
      "The Buyer(s) confirm they have received and read the RECO Information Guide as required under the Trust in Real Estate Services Act, 2020.",
      { size: 10 }
    );
    ctx.y -= 12;
    divider(ctx);

    line(ctx, "SIGNATURES", { bold: true, size: 11 });
    ctx.y -= 12;
    for (const buyer of buyers) {
      line(ctx, `Buyer: ${buyer.name}`, { size: 10 });
      line(ctx, "Signature: _________________________________    Date: __________", { size: 10, indent: 10 });
      ctx.y -= 8;
    }
    line(ctx, `Buyer's Agent: ${session.buyerAgentName ?? ""}`, { size: 10 });
    line(ctx, "Signature: _________________________________    Date: __________", { size: 10, indent: 10 });

    return doc.save();
  });
}

export async function generateForm100(
  session: TransactionSession
): Promise<Uint8Array> {
  const buyerNames = session.buyers.map((b) => b.name).join(", ");
  const today = new Date().toLocaleDateString("en-CA");

  const fieldMap: Record<string, string> = {
    buyer_name: buyerNames,
    property_address: session.propertyAddress ?? "",
    mls_number: session.mlsNumber ?? "",
    offer_price: session.offerPrice ?? "",
    deposit: session.depositAmount ?? "",
    closing_date: session.closingDate ?? "",
    irrevocability_date: session.irrevocabilityDate ?? "",
    listing_brokerage: session.listingBrokerageName ?? "",
    buyer_brokerage: session.buyerBrokerageName ?? "",
    date: today,
  };

  return fillOrCreatePdf("form100.pdf", fieldMap, async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
    const page = doc.addPage([612, 792]);
    const { width } = page.getSize();
    const margin = 50;
    const ctx: DrawCtx = { page, font, boldFont, y: 750, margin, width };

    line(ctx, "AGREEMENT OF PURCHASE AND SALE", { bold: true, size: 14 });
    line(ctx, "Form 100 — Ontario Real Estate Association", { size: 9 });
    ctx.y -= 8;
    divider(ctx);

    line(ctx, "PARTIES", { bold: true, size: 11 });
    ctx.y -= 4;
    field(ctx, "Buyer(s)", buyerNames);
    field(ctx, "Listing Brokerage", session.listingBrokerageName ?? "");
    field(ctx, "Buyer's Brokerage", session.buyerBrokerageName ?? "");
    ctx.y -= 6;
    divider(ctx);

    line(ctx, "PROPERTY", { bold: true, size: 11 });
    ctx.y -= 4;
    field(ctx, "MLS Number", session.mlsNumber ?? "");
    field(ctx, "Address", session.propertyAddress ?? "");
    ctx.y -= 6;
    divider(ctx);

    line(ctx, "OFFER DETAILS", { bold: true, size: 11 });
    ctx.y -= 4;
    field(ctx, "Purchase Price", session.offerPrice ?? "");
    field(ctx, "Deposit Amount", session.depositAmount ?? "");
    field(ctx, "Deposit Payable To", session.depositPayable ?? "Listing Brokerage in trust");
    field(ctx, "Closing / Completion Date", session.closingDate ?? "");
    field(ctx, "Irrevocability Date", session.irrevocabilityDate ?? "");
    field(ctx, "Date of Offer", today);
    ctx.y -= 6;
    divider(ctx);

    line(ctx, "CONDITIONS", { bold: true, size: 11 });
    ctx.y -= 4;
    if (session.clauses.length === 0) {
      line(ctx, "This offer is firm and binding with no conditions.", { size: 10 });
    } else {
      line(ctx, "This offer is conditional. See Schedule A attached.", { size: 10 });
    }
    ctx.y -= 8;
    divider(ctx);

    line(ctx, "SIGNATURES", { bold: true, size: 11 });
    ctx.y -= 12;
    for (const buyer of session.buyers) {
      line(ctx, `Buyer: ${buyer.name}`, { size: 10 });
      line(ctx, "Signature: _________________________________    Date: __________", { size: 10, indent: 10 });
      ctx.y -= 8;
    }
    line(ctx, "Seller Signature: _________________________________    Date: __________", { size: 10 });

    return doc.save();
  });
}

export async function generateScheduleA(
  session: TransactionSession
): Promise<Uint8Array> {
  const buyerNames = session.buyers.map((b) => b.name).join(", ");
  const today = new Date().toLocaleDateString("en-CA");

  return fillOrCreatePdf("scheduleA.pdf", {}, async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
    const page = doc.addPage([612, 792]);
    const { width } = page.getSize();
    const margin = 50;
    const ctx: DrawCtx = { page, font, boldFont, y: 750, margin, width };

    line(ctx, "SCHEDULE A", { bold: true, size: 14 });
    line(ctx, "To the Agreement of Purchase and Sale", { size: 10 });
    ctx.y -= 4;
    field(ctx, "Property", session.propertyAddress ?? "");
    field(ctx, "Buyer(s)", buyerNames);
    field(ctx, "Date", today);
    ctx.y -= 6;
    divider(ctx);

    line(ctx, "CONDITIONS AND CLAUSES", { bold: true, size: 11 });
    ctx.y -= 8;

    for (let i = 0; i < session.clauses.length; i++) {
      const clause = session.clauses[i]!;
      line(ctx, `${i + 1}. ${clause.label}`, { bold: true, size: 10 });
      ctx.y -= 4;
      line(ctx, clause.text, { size: 9, indent: 10 });
      ctx.y -= 10;

      if (ctx.y < 100) {
        const newPage = doc.addPage([612, 792]);
        ctx.page = newPage;
        ctx.y = 750;
      }
    }

    divider(ctx);
    line(ctx, "This Schedule forms part of and is incorporated into the Agreement of Purchase and Sale.", { size: 9 });
    ctx.y -= 12;
    line(ctx, "Buyer Initials: _______    Seller Initials: _______", { size: 10 });

    return doc.save();
  });
}

export async function generateForm320(
  session: TransactionSession
): Promise<Uint8Array> {
  const buyerNames = session.buyers.map((b) => b.name).join(", ");
  const today = new Date().toLocaleDateString("en-CA");

  const fieldMap: Record<string, string> = {
    buyer_name: buyerNames,
    property_address: session.propertyAddress ?? "",
    listing_brokerage: session.listingBrokerageName ?? "",
    buyer_brokerage: session.buyerBrokerageName ?? "",
    buyer_agent: session.buyerAgentName ?? "",
    coop_commission: session.coopCommission ?? "",
    date: today,
  };

  return fillOrCreatePdf("form320.pdf", fieldMap, async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
    const page = doc.addPage([612, 792]);
    const { width } = page.getSize();
    const margin = 50;
    const ctx: DrawCtx = { page, font, boldFont, y: 750, margin, width };

    line(ctx, "CONFIRMATION OF CO-OPERATION AND REPRESENTATION", { bold: true, size: 13 });
    line(ctx, "Form 320 — Ontario Real Estate Association", { size: 9 });
    ctx.y -= 8;
    divider(ctx);

    field(ctx, "Property Address", session.propertyAddress ?? "");
    field(ctx, "Buyer(s)", buyerNames);
    ctx.y -= 6;
    divider(ctx);

    line(ctx, "BROKERAGE REPRESENTATION", { bold: true, size: 11 });
    ctx.y -= 4;
    field(ctx, "Listing Brokerage", session.listingBrokerageName ?? "");
    line(ctx, "represents: [ ] The Seller  [ ] Both Buyer and Seller (Multiple Representation)", { size: 10, indent: 10 });
    ctx.y -= 8;
    field(ctx, "Co-operating / Buyer's Brokerage", session.buyerBrokerageName ?? "");
    field(ctx, "Buyer's Agent", session.buyerAgentName ?? "");
    line(ctx, "represents: [ ] The Buyer only", { size: 10, indent: 10 });
    ctx.y -= 8;
    divider(ctx);

    field(ctx, "Co-operating Commission", session.coopCommission ?? "");
    field(ctx, "Date", today);
    ctx.y -= 8;
    divider(ctx);

    line(ctx, "ACKNOWLEDGMENT", { bold: true, size: 11 });
    ctx.y -= 4;
    line(ctx, "The undersigned acknowledge the above Confirmation of Co-operation and Representation.", { size: 10 });
    ctx.y -= 12;
    line(ctx, "Buyer Signature: _________________________    Date: __________", { size: 10 });
    ctx.y -= 8;
    line(ctx, "Listing Brokerage: _______________________    Date: __________", { size: 10 });
    ctx.y -= 8;
    line(ctx, "Co-op Brokerage: _________________________    Date: __________", { size: 10 });

    return doc.save();
  });
}

export async function generateForm801(
  session: TransactionSession
): Promise<Uint8Array> {
  const buyerNames = session.buyers.map((b) => b.name).join(", ");
  const today = new Date().toLocaleDateString("en-CA");

  const fieldMap: Record<string, string> = {
    buyer_name: buyerNames,
    property_address: session.propertyAddress ?? "",
    offer_price: session.offerPrice ?? "",
    deposit: session.depositAmount ?? "",
    closing_date: session.closingDate ?? "",
    irrevocability: session.irrevocabilityDate ?? "",
    buyer_brokerage: session.buyerBrokerageName ?? "",
    listing_brokerage: session.listingBrokerageName ?? "",
    date: today,
  };

  return fillOrCreatePdf("form801.pdf", fieldMap, async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
    const page = doc.addPage([612, 792]);
    const { width } = page.getSize();
    const margin = 50;
    const ctx: DrawCtx = { page, font, boldFont, y: 750, margin, width };

    line(ctx, "OFFER SUMMARY DOCUMENT", { bold: true, size: 14 });
    line(ctx, "Form 801 — Ontario Real Estate Association", { size: 9 });
    ctx.y -= 8;
    divider(ctx);

    line(ctx, "This document is for information purposes only and does not form part of the Agreement of Purchase and Sale.", { size: 9 });
    ctx.y -= 8;
    divider(ctx);

    field(ctx, "Property Address", session.propertyAddress ?? "");
    field(ctx, "MLS Number", session.mlsNumber ?? "");
    field(ctx, "Buyer(s)", buyerNames);
    ctx.y -= 6;
    divider(ctx);

    line(ctx, "OFFER SUMMARY", { bold: true, size: 11 });
    ctx.y -= 4;
    field(ctx, "Purchase Price", session.offerPrice ?? "");
    field(ctx, "Deposit", session.depositAmount ?? "");
    field(ctx, "Closing Date", session.closingDate ?? "");
    field(ctx, "Irrevocability", session.irrevocabilityDate ?? "");
    field(ctx, "Conditions", session.clauses.length > 0
      ? session.clauses.map((c) => c.label).join(", ")
      : "None — Firm Offer");
    field(ctx, "Date Prepared", today);
    ctx.y -= 6;
    divider(ctx);

    field(ctx, "Buyer's Brokerage", session.buyerBrokerageName ?? "");
    field(ctx, "Listing Brokerage", session.listingBrokerageName ?? "");

    return doc.save();
  });
}
