import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PDFForm } from "pdf-lib";
import type { TransactionSession } from "../bot/session.js";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.resolve(__dirname, "../../forms/templates");

// ─── Merge ───────────────────────────────────────────────────────────────────

export async function mergePdfs(pdfBytes: Uint8Array[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  for (const bytes of pdfBytes) {
    try {
      const doc = await PDFDocument.load(bytes);
      const indices = Array.from({ length: doc.getPageCount() }, (_, i) => i);
      const pages = await merged.copyPages(doc, indices);
      for (const page of pages) merged.addPage(page);
    } catch {
      // skip unreadable chunks
    }
  }
  return merged.save();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function sanitize(text: string): string {
  return text.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function s(v: string | undefined | null, fallback = ""): string {
  return v ? sanitize(v) : fallback;
}

function setTxt(form: PDFForm, name: string, value: string): void {
  try { form.getTextField(name).setText(value || ""); } catch { /* field absent */ }
}

function checkBox(form: PDFForm, name: string): void {
  try { form.getCheckBox(name).check(); } catch { /* field absent */ }
}

function parseDate(dateStr: string | undefined) {
  if (!dateStr) return { day: "", monthLong: "", year2: "", year4: "" };
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return { day: dateStr, monthLong: "", year2: "", year4: "" };
  return {
    day: String(d.getDate()),
    monthLong: d.toLocaleString("en-CA", { month: "long" }),
    year2: String(d.getFullYear()).slice(2),
    year4: String(d.getFullYear()),
  };
}

function parseAddress(addr: string | undefined) {
  if (!addr) return { streetNum: "", streetName: "", unit: "", city: "", province: "ON", postal: "" };
  const m = addr.match(
    /^(?:(?:Unit\s*)?(\w+)\s*[-–]\s*)?(\d+[A-Za-z]?)\s+([^,]+?)\s*,\s*([^,]+?)\s*(?:,\s*([A-Z]{2})\s+([A-Z]\d[A-Z]\s?\d[A-Z]\d))?$/i
  );
  if (m) {
    return {
      unit: s(m[1]),
      streetNum: s(m[2]),
      streetName: s(m[3]),
      city: s(m[4]),
      province: m[5] ?? "ON",
      postal: s(m[6]),
    };
  }
  // Fallback — no comma, or non-standard
  const parts = addr.split(",");
  return {
    streetNum: "",
    streetName: s(parts[0]),
    unit: "",
    city: s(parts[1]),
    province: "ON",
    postal: s(parts[2]),
  };
}

async function loadDecryptedTemplate(name: string): Promise<PDFDocument> {
  const decPath = path.join(TEMPLATES_DIR, name.replace(".pdf", "_dec.pdf"));
  const origPath = path.join(TEMPLATES_DIR, name);
  const filePath = fs.existsSync(decPath) ? decPath : origPath;
  const bytes = fs.readFileSync(filePath);
  // _dec.pdf files are unencrypted (stripped by qpdf); originals need ignoreEncryption
  const useIgnore = filePath === origPath;
  return PDFDocument.load(bytes, useIgnore ? { ignoreEncryption: true } : {});
}

async function saveFlat(doc: PDFDocument): Promise<Uint8Array> {
  try { doc.getForm().flatten(); } catch { /* ignore flatten errors */ }
  return doc.save();
}

// ─── Scratch fallback (plain text PDF, no template) ──────────────────────────

type DrawCtx = { doc: PDFDocument; page: ReturnType<PDFDocument["addPage"]>; font: Awaited<ReturnType<PDFDocument["embedFont"]>>; boldFont: Awaited<ReturnType<PDFDocument["embedFont"]>>; y: number; margin: number; width: number };

async function scratchDoc() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([612, 792]);
  const ctx: DrawCtx = { doc, page, font, boldFont, y: 750, margin: 50, width: 612 };
  return { doc, ctx };
}

function scratchLine(ctx: DrawCtx, text: string, opts: { bold?: boolean; size?: number; indent?: number } = {}): void {
  const f = opts.bold ? ctx.boldFont : ctx.font;
  const size = opts.size ?? 10;
  const x = ctx.margin + (opts.indent ?? 0);
  const maxWidth = ctx.width - ctx.margin * 2 - (opts.indent ?? 0);
  const words = sanitize(text).split(" ");
  let cur = "";
  const lines: string[] = [];
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (f.widthOfTextAtSize(t, size) > maxWidth && cur) { lines.push(cur); cur = w; } else { cur = t; }
  }
  if (cur) lines.push(cur);
  for (const l of lines) {
    ctx.page.drawText(l, { x, y: ctx.y, size, font: f, color: rgb(0, 0, 0) });
    ctx.y -= size + 4;
  }
}

function scratchField(ctx: DrawCtx, label: string, value: string | undefined): void {
  scratchLine(ctx, label, { bold: true, size: 9 });
  scratchLine(ctx, value ?? "___________________________", { size: 9, indent: 10 });
  ctx.y -= 3;
}

function scratchDivider(ctx: DrawCtx): void {
  ctx.page.drawLine({ start: { x: ctx.margin, y: ctx.y + 4 }, end: { x: ctx.width - ctx.margin, y: ctx.y + 4 }, thickness: 0.5, color: rgb(0.5, 0.5, 0.5) });
  ctx.y -= 12;
}

// ─── Form 300 — Buyer Representation Agreement ───────────────────────────────

export async function generateForm300(session: TransactionSession): Promise<Uint8Array> {
  const buyer1 = session.buyers[0]?.name ?? "";
  const buyer2 = session.buyers[1]?.name ?? "";
  const today = new Date();
  const dd = String(today.getDate());
  const mm = today.toLocaleString("en-CA", { month: "long" });
  const yy = String(today.getFullYear()).slice(2);
  const yyyy = String(today.getFullYear());

  // Expiry: 90 days from today
  const expiry = new Date(today);
  expiry.setDate(expiry.getDate() + 90);
  const expDD = String(expiry.getDate());
  const expMM = expiry.toLocaleString("en-CA", { month: "long" });
  const expYY = String(expiry.getFullYear()).slice(2);

  const addr = parseAddress(session.propertyAddress);

  try {
    const doc = await loadDecryptedTemplate("form300.pdf");
    const form = doc.getForm();

    setTxt(form, "txts_broker", s(session.buyerBrokerageName));
    setTxt(form, "txts_brkagent", s(session.buyerAgentName));
    setTxt(form, "txtbuyer1", buyer1);
    setTxt(form, "txtbuyer2", buyer2);
    setTxt(form, "txtb_streetnum", addr.streetNum);
    setTxt(form, "txtb_street", addr.streetName);
    setTxt(form, "txtb_city", addr.city || "Ontario");
    setTxt(form, "txtb_zipcode", addr.postal);
    setTxt(form, "txtb_phone1", s(session.buyers[0]?.phone));
    setTxt(form, "txtb2_phone1", s(session.buyers[1]?.phone));
    // Commencing date
    setTxt(form, "txtCommencingDate_d", dd);
    setTxt(form, "txtCommencingDate_m", mm);
    setTxt(form, "txtCommencingDate_yy", yy);
    // Expiry date
    setTxt(form, "txtExpiringDate_d", expDD);
    setTxt(form, "txtExpiringDate_m", expMM);
    setTxt(form, "txtExpiringDate_yy", expYY);
    // Property type & location
    setTxt(form, "txtp_type", "Residential");
    setTxt(form, "txtp_location", s(session.propertyAddress, "As described by Buyer"));
    // Copy date
    setTxt(form, "txtcopy_d", dd);
    setTxt(form, "txtcopy_m", mm);
    setTxt(form, "txtcopy_y", yyyy);

    return saveFlat(doc);
  } catch {
    const { doc, ctx } = await scratchDoc();
    scratchLine(ctx, "BUYER REPRESENTATION AGREEMENT", { bold: true, size: 14 });
    scratchLine(ctx, "Form 300 — Ontario Real Estate Association", { size: 9 });
    ctx.y -= 8; scratchDivider(ctx);
    scratchField(ctx, "Buyer(s)", [buyer1, buyer2].filter(Boolean).join(", "));
    scratchField(ctx, "Brokerage", s(session.buyerBrokerageName));
    scratchField(ctx, "Agent", s(session.buyerAgentName));
    scratchField(ctx, "Geographic Location", s(session.propertyAddress, "As described by Buyer"));
    scratchField(ctx, "Date", `${dd} ${mm} ${yyyy}`);
    return doc.save();
  }
}

// ─── Form 100 — Agreement of Purchase and Sale ───────────────────────────────

export async function generateForm100(session: TransactionSession): Promise<Uint8Array> {
  const buyer1 = session.buyers[0]?.name ?? "";
  const buyer2 = session.buyers[1]?.name ?? "";
  const today = new Date();
  const dd = String(today.getDate());
  const mm = today.toLocaleString("en-CA", { month: "long" });
  const yy = String(today.getFullYear()).slice(2);

  const closing = parseDate(session.closingDate);
  const irrev = parseDate(session.irrevocabilityDate);
  const addr = parseAddress(session.propertyAddress);

  const priceFmt = s(session.offerPrice);
  const depFmt = s(session.depositAmount);

  try {
    const doc = await loadDecryptedTemplate("form100.pdf");
    const form = doc.getForm();

    // Buyers / Sellers
    setTxt(form, "txtbuyer1", buyer1);
    setTxt(form, "txtbuyer2", buyer2);
    setTxt(form, "txtseller1", s(session.listingBrokerageName, "As per listing"));

    // Property address
    setTxt(form, "txtp_streetnum", addr.streetNum);
    setTxt(form, "txtp_street", addr.streetName);
    setTxt(form, "txtp_unitNumber", addr.unit);
    setTxt(form, "txtp_city", addr.city);
    setTxt(form, "txtp_state", addr.province);
    setTxt(form, "txtp_zipcode", addr.postal);

    // Offer date
    setTxt(form, "txtp_OfferDate_d", dd);
    setTxt(form, "txtp_OfferDate_mmmm", mm);
    setTxt(form, "txtp_OfferDate_yy", yy);

    // Price
    setTxt(form, "txtp_price", priceFmt);
    setTxt(form, "txtp_pricewords", priceFmt);

    // Deposit
    setTxt(form, "txtp_depositwords", depFmt);
    setTxt(form, "txtp_deposit", depFmt);
    setTxt(form, "txtDepositHolder", s(session.depositPayable, "Listing Brokerage In Trust"));

    // Irrevocability
    setTxt(form, "txtp_irrev_t", "11:59");
    checkBox(form, "chkOpt_irrevocability_ampm"); // p.m.
    setTxt(form, "txtp_OfferExpireDate_d", irrev.day);
    setTxt(form, "txtp_OfferExpireDate_mmmm", irrev.monthLong);
    setTxt(form, "txtp_OfferExpireDate_yy", irrev.year2);

    // Closing date
    setTxt(form, "txtp_closedate_d", closing.day);
    setTxt(form, "txtp_closedate_mmmm", closing.monthLong);
    setTxt(form, "txtp_closedate_yy", closing.year2);

    // Brokerages
    setTxt(form, "txtl_broker", s(session.listingBrokerageName));
    setTxt(form, "txts_broker", s(session.buyerBrokerageName));
    setTxt(form, "txts_brkagent", s(session.buyerAgentName));

    return saveFlat(doc);
  } catch {
    const { doc, ctx } = await scratchDoc();
    scratchLine(ctx, "AGREEMENT OF PURCHASE AND SALE", { bold: true, size: 14 });
    scratchLine(ctx, "Form 100 — Ontario Real Estate Association", { size: 9 });
    ctx.y -= 8; scratchDivider(ctx);
    scratchField(ctx, "Buyer(s)", [buyer1, buyer2].filter(Boolean).join(", "));
    scratchField(ctx, "Seller / Listing Brokerage", s(session.listingBrokerageName, "As per MLS"));
    scratchField(ctx, "Property Address", s(session.propertyAddress));
    scratchField(ctx, "Purchase Price", priceFmt);
    scratchField(ctx, "Deposit", depFmt);
    scratchField(ctx, "Deposit Payable To", s(session.depositPayable, "Listing Brokerage In Trust"));
    scratchField(ctx, "Closing Date", s(session.closingDate));
    scratchField(ctx, "Irrevocability", s(session.irrevocabilityDate));
    scratchField(ctx, "Date of Offer", `${dd} ${mm} 20${yy}`);
    return doc.save();
  }
}

// ─── Schedule A — Conditions & Clauses ───────────────────────────────────────

export async function generateScheduleA(session: TransactionSession): Promise<Uint8Array> {
  const buyer1 = session.buyers[0]?.name ?? "";
  const buyer2 = session.buyers[1]?.name ?? "";
  const today = new Date();
  const dd = String(today.getDate());
  const mm = today.toLocaleString("en-CA", { month: "long" });
  const yy = String(today.getFullYear()).slice(2);
  const addr = parseAddress(session.propertyAddress);

  const clauseText = session.clauses.length > 0
    ? session.clauses.map((c, i) => `${i + 1}. ${c.label}\n${c.text}`).join("\n\n")
    : "This offer is firm and binding with no conditions.";

  try {
    const doc = await loadDecryptedTemplate("scheduleA.pdf");
    const form = doc.getForm();

    setTxt(form, "txtbuyer1", buyer1);
    setTxt(form, "txtbuyer2", buyer2);
    setTxt(form, "txtseller1", s(session.listingBrokerageName, "As per listing"));
    setTxt(form, "txtp_streetnum", addr.streetNum);
    setTxt(form, "txtp_street", addr.streetName);
    setTxt(form, "txtp_UnitNumber", addr.unit);
    setTxt(form, "txtp_city", addr.city);
    setTxt(form, "txtp_state", addr.province);
    setTxt(form, "txtp_zipcode", addr.postal);
    setTxt(form, "txtp_OfferDate_d", dd);
    setTxt(form, "txtp_OfferDate_mmmm", mm);
    setTxt(form, "txtp_OfferDate_yy", yy);
    setTxt(form, "txtschedule", clauseText);

    return saveFlat(doc);
  } catch {
    // Scratch fallback with clause text
    const { doc, ctx } = await scratchDoc();
    scratchLine(ctx, "SCHEDULE A — Conditions and Clauses", { bold: true, size: 14 });
    scratchLine(ctx, "To the Agreement of Purchase and Sale", { size: 10 });
    ctx.y -= 4;
    scratchField(ctx, "Property", s(session.propertyAddress));
    scratchField(ctx, "Buyer(s)", [buyer1, buyer2].filter(Boolean).join(", "));
    ctx.y -= 6; scratchDivider(ctx);
    for (let i = 0; i < session.clauses.length; i++) {
      const clause = session.clauses[i]!;
      scratchLine(ctx, `${i + 1}. ${clause.label}`, { bold: true, size: 9 });
      ctx.y -= 2;
      scratchLine(ctx, clause.text, { size: 8, indent: 10 });
      ctx.y -= 8;
      if (ctx.y < 100) {
        const np = doc.addPage([612, 792]);
        ctx.page = np; ctx.y = 750;
      }
    }
    if (session.clauses.length === 0) scratchLine(ctx, "This offer is firm and binding with no conditions.", { size: 9 });
    return doc.save();
  }
}

// ─── Form 320 — Confirmation of Co-operation ─────────────────────────────────

export async function generateForm320(session: TransactionSession): Promise<Uint8Array> {
  const buyer1 = session.buyers[0]?.name ?? "";
  const buyer2 = session.buyers[1]?.name ?? "";
  const addr = parseAddress(session.propertyAddress);

  try {
    const doc = await loadDecryptedTemplate("form320.pdf");
    const form = doc.getForm();

    setTxt(form, "txtbuyer1", buyer1);
    setTxt(form, "txtbuyer2", buyer2);
    setTxt(form, "txtseller1", s(session.listingBrokerageName, "As per listing"));

    setTxt(form, "txtp_streetnum", addr.streetNum);
    setTxt(form, "txtp_street", addr.streetName);
    setTxt(form, "txtp_UnitNumber", addr.unit);
    setTxt(form, "txtp_city", addr.city);
    setTxt(form, "txtp_state", addr.province);
    setTxt(form, "txtp_zipcode", addr.postal);

    // Buyer's brokerage
    setTxt(form, "txts_broker", s(session.buyerBrokerageName));
    setTxt(form, "txts_brkagent", s(session.buyerAgentName));

    // Listing brokerage
    setTxt(form, "txtl_broker", s(session.listingBrokerageName));

    // Co-op commission (section 4b)
    setTxt(form, "txtcoopCommisionC1", s(session.coopCommission));
    checkBox(form, "chkOpt_CoOp"); // co-operating brokerage is buyer's brokerage

    return saveFlat(doc);
  } catch {
    const { doc, ctx } = await scratchDoc();
    scratchLine(ctx, "CONFIRMATION OF CO-OPERATION AND REPRESENTATION", { bold: true, size: 13 });
    scratchLine(ctx, "Form 320 — Ontario Real Estate Association", { size: 9 });
    ctx.y -= 8; scratchDivider(ctx);
    scratchField(ctx, "Buyer(s)", [buyer1, buyer2].filter(Boolean).join(", "));
    scratchField(ctx, "Seller / Listing Brokerage", s(session.listingBrokerageName));
    scratchField(ctx, "Property", s(session.propertyAddress));
    scratchField(ctx, "Co-operating Commission", s(session.coopCommission));
    scratchField(ctx, "Buyer's Brokerage", s(session.buyerBrokerageName));
    scratchField(ctx, "Buyer's Agent", s(session.buyerAgentName));
    return doc.save();
  }
}

// ─── Form 801 — Offer Summary Document ───────────────────────────────────────

export async function generateForm801(session: TransactionSession): Promise<Uint8Array> {
  const buyer1 = session.buyers[0]?.name ?? "";
  const buyer2 = session.buyers[1]?.name ?? "";
  const today = new Date();
  const dd = String(today.getDate());
  const mm = today.toLocaleString("en-CA", { month: "long" });
  const yy = String(today.getFullYear()).slice(2);
  const addr = parseAddress(session.propertyAddress);

  try {
    const doc = await loadDecryptedTemplate("form801.pdf");
    const form = doc.getForm();

    // Property address
    setTxt(form, "txtp_streetnum", addr.streetNum);
    setTxt(form, "txtp_street", addr.streetName);
    setTxt(form, "txtp_UnitNumber", addr.unit);
    setTxt(form, "txtp_city", addr.city);
    setTxt(form, "txtp_state", addr.province);
    setTxt(form, "txtp_zipcode", addr.postal);

    // Offer date
    setTxt(form, "txtp_OfferDate_d", dd);
    setTxt(form, "txtp_OfferDate_mmmm", mm);
    setTxt(form, "txtp_OfferDate_yy", yy);

    // Buyer's brokerage / agent
    setTxt(form, "txts_broker", s(session.buyerBrokerageName));
    setTxt(form, "txts_brkagent", s(session.buyerAgentName));

    // Buyers
    setTxt(form, "txtbuyer1", buyer1);
    setTxt(form, "txtbuyer2", buyer2);

    // Sellers / Listing side
    setTxt(form, "txtseller1", s(session.listingBrokerageName, "As per listing"));
    setTxt(form, "txtl_broker", s(session.listingBrokerageName));

    // Offer submitted
    setTxt(form, "txtSubmittedBy", s(session.buyerBrokerageName));
    setTxt(form, "txtOfferDate123_d", dd);
    setTxt(form, "txtOfferDate123_m", mm);
    setTxt(form, "txtOfferDate123_y", String(today.getFullYear()));

    return saveFlat(doc);
  } catch {
    const { doc, ctx } = await scratchDoc();
    scratchLine(ctx, "OFFER SUMMARY DOCUMENT", { bold: true, size: 14 });
    scratchLine(ctx, "Form 801 — Ontario Real Estate Association", { size: 9 });
    ctx.y -= 8; scratchDivider(ctx);
    scratchField(ctx, "Property Address", s(session.propertyAddress));
    scratchField(ctx, "Buyer(s)", [buyer1, buyer2].filter(Boolean).join(", "));
    scratchField(ctx, "Buyer's Brokerage", s(session.buyerBrokerageName));
    scratchField(ctx, "Agent", s(session.buyerAgentName));
    scratchDivider(ctx);
    scratchField(ctx, "Purchase Price", s(session.offerPrice));
    scratchField(ctx, "Deposit", s(session.depositAmount));
    scratchField(ctx, "Closing Date", s(session.closingDate));
    scratchField(ctx, "Irrevocability", s(session.irrevocabilityDate));
    scratchField(ctx, "Conditions", session.clauses.length > 0 ? session.clauses.map((c) => c.label).join(", ") : "None — Firm Offer");
    scratchDivider(ctx);
    scratchField(ctx, "Listing Brokerage", s(session.listingBrokerageName));
    return doc.save();
  }
}
