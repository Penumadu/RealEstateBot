import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from "pdf-lib";
import type { TransactionSession } from "../bot/session.js";
import { renderTemplatePages, type RenderedPage } from "./pdfRenderer.js";

// ─── Sanitize ───────────────────────────────────────────────────────────────

export function sanitize(text: string): string {
  return text.replace(/[\r\n]+/g, ", ").replace(/\s+/g, " ").trim();
}

function s(v: string | undefined | null, fallback = ""): string {
  return v ? sanitize(v) : fallback;
}

// ─── Overlay helpers ─────────────────────────────────────────────────────────

type Overlay = {
  page: number;   // 1-based
  x: number;
  y: number;
  text: string;
  size?: number;
  maxWidth?: number;
};

/** Build a PDF from template pages with text overlaid at the given coordinates. */
async function overlayOnTemplate(
  templateName: string,
  overlays: Overlay[],
  fallback: () => Promise<Uint8Array>
): Promise<Uint8Array> {
  let pages: RenderedPage[];
  try {
    pages = await renderTemplatePages(templateName);
  } catch {
    pages = [];
  }

  if (pages.length === 0) return fallback();

  try {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);

    for (let i = 0; i < pages.length; i++) {
      const { pngBytes, width, height } = pages[i]!;
      const bg = await doc.embedPng(pngBytes);
      const page = doc.addPage([width, height]);
      page.drawImage(bg, { x: 0, y: 0, width, height });

      for (const ov of overlays.filter((o) => o.page === i + 1)) {
        if (!ov.text) continue;
        const text = sanitize(ov.text);
        const size = ov.size ?? 8;
        if (ov.maxWidth) {
          drawWrappedText(page, font, text, ov.x, ov.y, size, ov.maxWidth);
        } else {
          page.drawText(text, { x: ov.x, y: ov.y, size, font, color: rgb(0, 0, 0) });
        }
      }
    }

    return doc.save();
  } catch {
    return fallback();
  }
}

/** Draw text wrapping within maxWidth, advancing y downward. Returns final y. */
function drawWrappedText(
  page: PDFPage,
  font: PDFFont,
  text: string,
  x: number,
  startY: number,
  size: number,
  maxWidth: number
): number {
  const lineHeight = size + 3;
  const words = text.split(" ");
  let line = "";
  let y = startY;

  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
      page.drawText(line, { x, y, size, font, color: rgb(0, 0, 0) });
      y -= lineHeight;
      line = word;
    } else {
      line = test;
    }
  }
  if (line) {
    page.drawText(line, { x, y, size, font, color: rgb(0, 0, 0) });
    y -= lineHeight;
  }
  return y;
}

// ─── Scratch-pad helpers (fallback if template unavailable) ──────────────────

type DrawCtx = { page: PDFPage; font: PDFFont; boldFont: PDFFont; y: number; margin: number; width: number };

function scratchLine(ctx: DrawCtx, text: string, opts: { bold?: boolean; size?: number; indent?: number } = {}): void {
  const { page, font, boldFont, margin, width } = ctx;
  const f = opts.bold ? boldFont : font;
  const size = opts.size ?? 10;
  const x = margin + (opts.indent ?? 0);
  const maxWidth = width - margin * 2 - (opts.indent ?? 0);
  const words = sanitize(text).split(" ");
  let cur = "";
  const lines: string[] = [];
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (f.widthOfTextAtSize(t, size) > maxWidth && cur) { lines.push(cur); cur = w; } else { cur = t; }
  }
  if (cur) lines.push(cur);
  for (const l of lines) {
    page.drawText(l, { x, y: ctx.y, size, font: f, color: rgb(0, 0, 0) });
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

async function scratchDoc(): Promise<{ doc: PDFDocument; ctx: DrawCtx }> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([612, 792]);
  const ctx: DrawCtx = { page, font, boldFont, y: 750, margin: 50, width: 612 };
  return { doc, ctx };
}

// ─── Form 300 — Buyer Representation Agreement ───────────────────────────────
// Field coordinates mapped from coordinate grid screenshot:
//   BROKERAGE       y≈660  x≈120
//   Brokerage Addr  y≈644  x≈100
//   BUYER           y≈612  x≈120
//   Buyer Addr      y≈580  x≈100
//   Municipality    y≈566  x≈130   Postal Code  y≈566  x≈415
//   Commencing am   y≈543  x≈80    day          y≈543  x≈260   yr  y≈543  x≈430
//   Expiring  day   y≈527  x≈185                month  y≈527  x≈380
//   Property Type   y≈458  x≈155
//   Geographic Loc  y≈428  x≈155
//   Commission %    y≈148  x≈155

export async function generateForm300(session: TransactionSession): Promise<Uint8Array> {
  const buyerNames = session.buyers.map((b) => b.name).join(", ");
  const today = new Date();
  const dd = String(today.getDate());
  const mm = today.toLocaleString("en-CA", { month: "long" });
  const yy = String(today.getFullYear()).slice(2);
  const yyyy = String(today.getFullYear());

  const overlays: Overlay[] = [
    // BROKERAGE name
    { page: 1, x: 120, y: 660, text: s(session.buyerBrokerageName) },
    // BUYER name
    { page: 1, x: 120, y: 612, text: buyerNames, maxWidth: 380 },
    // Buyer address
    { page: 1, x: 100, y: 580, text: s(session.propertyAddress), maxWidth: 460 },
    // Municipality
    { page: 1, x: 130, y: 566, text: "Ontario" },
    // Commencing: "on the ... day of ... , 20..."
    { page: 1, x: 260, y: 543, text: dd },
    { page: 1, x: 330, y: 543, text: mm },
    { page: 1, x: 500, y: 543, text: yy },
    // Expiry (same date for now — agent fills)
    { page: 1, x: 185, y: 527, text: dd },
    { page: 1, x: 260, y: 527, text: mm },
    { page: 1, x: 430, y: 527, text: yyyy },
    // Property type
    { page: 1, x: 155, y: 458, text: "Residential" },
    // Geographic location
    { page: 1, x: 155, y: 428, text: s(session.propertyAddress, "As described by Buyer"), maxWidth: 400 },
    // Agent name on page 4 — leave for signature; not overlaid
  ];

  return overlayOnTemplate("form300.pdf", overlays, async () => {
    const { doc, ctx } = await scratchDoc();
    scratchLine(ctx, "BUYER REPRESENTATION AGREEMENT", { bold: true, size: 14 });
    scratchLine(ctx, "Form 300 — Ontario Real Estate Association", { size: 9 });
    ctx.y -= 8; scratchDivider(ctx);
    scratchField(ctx, "Buyer(s)", buyerNames);
    scratchField(ctx, "Brokerage", s(session.buyerBrokerageName));
    scratchField(ctx, "Agent", s(session.buyerAgentName));
    scratchField(ctx, "Geographic Location", s(session.propertyAddress, "As described by Buyer"));
    scratchField(ctx, "Date", `${dd} ${mm} ${yyyy}`);
    return doc.save();
  });
}

// ─── Form 100 — Agreement of Purchase and Sale ───────────────────────────────
// Field coordinates (verified from overlay preview):
//   Agreement dated day   y≈678 x≈190    month  y≈678 x≈355    yr  y≈678 x≈560
//   BUYER                 y≈653 x≈90  (maxWidth 460)
//   SELLER                y≈618 x≈90  (maxWidth 460)
//   Property Address      y≈563 x≈90  (maxWidth 460)
//   Purchase Price ($)    y≈413 x≈425 (maxWidth 150)
//   Purchase Price (words)y≈393 x≈90  (maxWidth 460)
//   DEPOSIT method        y≈362 x≈205 (maxWidth 200) — after "DEPOSIT: Buyer submits" label
//   DEPOSIT ($)           y≈342 x≈430 (maxWidth 150)
//   Deposit payable to    y≈302 x≈90  (maxWidth 300)
//   Irrevocability by     y≈200 x≈207 (maxWidth 220)
//   Irrevocability day    y≈176 x≈90  month y≈176 x≈230  yr y≈176 x≈420
//   Completion day        y≈133 x≈530 month y≈114 x≈90   yr y≈114 x≈400

export async function generateForm100(session: TransactionSession): Promise<Uint8Array> {
  const buyerNames = session.buyers.map((b) => b.name).join(", ");
  const today = new Date();
  const dd = String(today.getDate());
  const mm = today.toLocaleString("en-CA", { month: "long" });
  const yyyy = String(today.getFullYear());

  // Parse closing date if available: expect "Month DD, YYYY" or "YYYY-MM-DD"
  let closingDay = "", closingMonth = "", closingYear = "";
  if (session.closingDate) {
    const d = new Date(session.closingDate);
    if (!isNaN(d.getTime())) {
      closingDay = String(d.getDate());
      closingMonth = d.toLocaleString("en-CA", { month: "long" });
      closingYear = String(d.getFullYear());
    } else {
      closingDay = session.closingDate;
    }
  }

  let irrevDay = "", irrevMonth = "", irrevYear = "";
  if (session.irrevocabilityDate) {
    const d = new Date(session.irrevocabilityDate);
    if (!isNaN(d.getTime())) {
      irrevDay = String(d.getDate());
      irrevMonth = d.toLocaleString("en-CA", { month: "long" });
      irrevYear = String(d.getFullYear());
    } else {
      irrevDay = session.irrevocabilityDate;
    }
  }

  const priceFmt = s(session.offerPrice);
  const depFmt = s(session.depositAmount);

  const overlays: Overlay[] = [
    // Agreement dated
    { page: 1, x: 190, y: 678, text: dd },
    { page: 1, x: 355, y: 678, text: mm },
    { page: 1, x: 560, y: 678, text: yyyy.slice(2) },
    // Buyer
    { page: 1, x: 90, y: 653, text: buyerNames, maxWidth: 460 },
    // Seller (listing brokerage name or "Vendor" placeholder)
    { page: 1, x: 90, y: 618, text: s(session.listingBrokerageName, "As per MLS"), maxWidth: 460 },
    // Property address
    { page: 1, x: 90, y: 563, text: s(session.propertyAddress), maxWidth: 460 },
    // Purchase price (number)
    { page: 1, x: 425, y: 413, text: priceFmt, maxWidth: 160 },
    // Purchase price (words) — just repeat dollar amount
    { page: 1, x: 90, y: 393, text: priceFmt, maxWidth: 460 },
    // Deposit method — after "DEPOSIT: Buyer submits" label ends at ~x=200
    { page: 1, x: 205, y: 362, text: "Herewith", maxWidth: 200 },
    // Deposit amount
    { page: 1, x: 430, y: 342, text: depFmt, maxWidth: 150 },
    // Deposit payable to
    { page: 1, x: 90, y: 302, text: s(session.depositPayable, "Listing Brokerage in Trust"), maxWidth: 300 },
    // Irrevocability
    { page: 1, x: 207, y: 200, text: s(session.buyerAgentName, "Buyer"), maxWidth: 200 },
    { page: 1, x: 90, y: 176, text: irrevDay },
    { page: 1, x: 230, y: 176, text: irrevMonth },
    { page: 1, x: 420, y: 176, text: irrevYear },
    // Completion date
    { page: 1, x: 530, y: 133, text: closingDay },
    { page: 1, x: 90, y: 114, text: closingMonth },
    { page: 1, x: 400, y: 114, text: closingYear },
  ];

  return overlayOnTemplate("form100.pdf", overlays, async () => {
    const { doc, ctx } = await scratchDoc();
    scratchLine(ctx, "AGREEMENT OF PURCHASE AND SALE", { bold: true, size: 14 });
    scratchLine(ctx, "Form 100 — Ontario Real Estate Association", { size: 9 });
    ctx.y -= 8; scratchDivider(ctx);
    scratchField(ctx, "Buyer(s)", buyerNames);
    scratchField(ctx, "Seller / Listing Brokerage", s(session.listingBrokerageName, "As per MLS"));
    scratchField(ctx, "Property Address", s(session.propertyAddress));
    scratchField(ctx, "Purchase Price", priceFmt);
    scratchField(ctx, "Deposit", depFmt);
    scratchField(ctx, "Deposit Payable To", s(session.depositPayable, "Listing Brokerage in Trust"));
    scratchField(ctx, "Closing Date", s(session.closingDate));
    scratchField(ctx, "Irrevocability", s(session.irrevocabilityDate));
    scratchField(ctx, "Date of Offer", `${dd} ${mm} ${yyyy}`);
    scratchDivider(ctx);
    scratchLine(ctx, session.clauses.length > 0 ? "This offer is conditional. See Schedule A attached." : "This offer is firm — no conditions.", { size: 9 });
    return doc.save();
  });
}

// ─── Schedule A — Conditions & Clauses ───────────────────────────────────────
// Field coordinates:
//   BUYER           y≈651 x≈90  (maxWidth 460)
//   SELLER          y≈634 x≈90  (maxWidth 460)
//   Property        y≈613 x≈165 (maxWidth 380)
//   dated the       y≈593 x≈90  (maxWidth 80)  day of y≈593 x≈230 yr y≈593 x≈520
//   Content area    starts y≈540, left x≈50, right x≈560, maxWidth 510

export async function generateScheduleA(session: TransactionSession): Promise<Uint8Array> {
  const buyerNames = session.buyers.map((b) => b.name).join(", ");
  const today = new Date();
  const dd = String(today.getDate());
  const mm = today.toLocaleString("en-CA", { month: "long" });
  const yyyy = String(today.getFullYear());

  const overlays: Overlay[] = [
    { page: 1, x: 90, y: 651, text: buyerNames, maxWidth: 460 },
    { page: 1, x: 90, y: 634, text: s(session.listingBrokerageName, "As per listing"), maxWidth: 460 },
    { page: 1, x: 165, y: 613, text: s(session.propertyAddress), maxWidth: 380 },
    { page: 1, x: 90, y: 593, text: dd },
    { page: 1, x: 230, y: 593, text: mm },
    { page: 1, x: 520, y: 593, text: yyyy.slice(2) },
  ];

  // Clauses are placed in the open content area starting at y=540
  // We do NOT add them as overlays above since we need dynamic multi-page wrapping.
  // Instead, build the template background pages first, then append clause text.
  const pages = await (async () => {
    try { return await renderTemplatePages("scheduleA.pdf"); } catch { return [] as RenderedPage[]; }
  })();

  if (pages.length === 0) {
    // Full scratch fallback
    const { doc, ctx } = await scratchDoc();
    scratchLine(ctx, "SCHEDULE A — Conditions and Clauses", { bold: true, size: 14 });
    scratchLine(ctx, "To the Agreement of Purchase and Sale", { size: 10 });
    ctx.y -= 4;
    scratchField(ctx, "Property", s(session.propertyAddress));
    scratchField(ctx, "Buyer(s)", buyerNames);
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
    scratchDivider(ctx);
    scratchLine(ctx, "This Schedule forms part of the Agreement of Purchase and Sale.", { size: 9 });
    return doc.save();
  }

  // Build PDF with template background, then draw clauses in content area
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  // Page 1: template background + header fields + clause text
  const { pngBytes: pg1Bytes, width, height } = pages[0]!;
  const bg1 = await doc.embedPng(pg1Bytes);
  const page1 = doc.addPage([width, height]);
  page1.drawImage(bg1, { x: 0, y: 0, width, height });

  // Draw header overlays
  for (const ov of overlays) {
    if (!ov.text || ov.page !== 1) continue;
    const t = sanitize(ov.text);
    if (ov.maxWidth) {
      drawWrappedText(page1, font, t, ov.x, ov.y, ov.size ?? 8, ov.maxWidth);
    } else {
      page1.drawText(t, { x: ov.x, y: ov.y, size: ov.size ?? 8, font, color: rgb(0, 0, 0) });
    }
  }

  // Clause text area
  const clauseLeft = 50;
  const clauseRight = 560;
  const clauseWidth = clauseRight - clauseLeft;
  const clauseStartY = 540;
  const clauseMinY = 125;
  const lineH = 10;

  let currentPage = page1;
  let y = clauseStartY;

  function ensureSpace(needed: number) {
    if (y - needed >= clauseMinY) return;
    // Add continuation page (blank)
    const np = doc.addPage([width, height]);
    np.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 1, 1) });
    np.drawText("Schedule A (continued)", { x: clauseLeft, y: height - 30, size: 9, font: boldFont, color: rgb(0, 0, 0) });
    currentPage = np;
    y = height - 50;
  }

  for (let i = 0; i < session.clauses.length; i++) {
    const clause = session.clauses[i]!;
    ensureSpace(lineH + 4);

    // Clause label
    currentPage.drawText(`${i + 1}. ${sanitize(clause.label)}`, {
      x: clauseLeft, y,
      size: 8, font: boldFont, color: rgb(0, 0, 0),
    });
    y -= lineH + 2;

    // Clause body — word-wrap
    const words = sanitize(clause.text).split(" ");
    let line = "";
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(test, 8) > clauseWidth && line) {
        ensureSpace(lineH);
        currentPage.drawText(line, { x: clauseLeft + 10, y, size: 8, font, color: rgb(0, 0, 0) });
        y -= lineH;
        line = word;
      } else {
        line = test;
      }
    }
    if (line) {
      ensureSpace(lineH);
      currentPage.drawText(line, { x: clauseLeft + 10, y, size: 8, font, color: rgb(0, 0, 0) });
      y -= lineH;
    }
    y -= 6; // gap between clauses
  }

  if (session.clauses.length === 0) {
    currentPage.drawText("This offer is firm and binding with no conditions.", {
      x: clauseLeft, y, size: 8, font, color: rgb(0, 0, 0),
    });
  }

  return doc.save();
}

// ─── Form 320 — Confirmation of Co-operation ─────────────────────────────────
// Field coordinates:
//   BUYER           y≈679 x≈90  (maxWidth 460)
//   SELLER          y≈660 x≈90  (maxWidth 460)
//   Property        y≈641 x≈170 (maxWidth 370)
//   Section 4a1 co-op commission amount: y≈195 x≈110 (maxWidth 180)

export async function generateForm320(session: TransactionSession): Promise<Uint8Array> {
  const buyerNames = session.buyers.map((b) => b.name).join(", ");

  const overlays: Overlay[] = [
    { page: 1, x: 90, y: 679, text: buyerNames, maxWidth: 460 },
    { page: 1, x: 90, y: 660, text: s(session.listingBrokerageName, "As per listing"), maxWidth: 460 },
    { page: 1, x: 170, y: 641, text: s(session.propertyAddress), maxWidth: 370 },
    // Co-op commission amount (section 4b1)
    { page: 1, x: 110, y: 195, text: s(session.coopCommission), maxWidth: 180 },
  ];

  return overlayOnTemplate("form320.pdf", overlays, async () => {
    const { doc, ctx } = await scratchDoc();
    scratchLine(ctx, "CONFIRMATION OF CO-OPERATION AND REPRESENTATION", { bold: true, size: 13 });
    scratchLine(ctx, "Form 320 — Ontario Real Estate Association", { size: 9 });
    ctx.y -= 8; scratchDivider(ctx);
    scratchField(ctx, "Buyer(s)", buyerNames);
    scratchField(ctx, "Seller / Listing Brokerage", s(session.listingBrokerageName));
    scratchField(ctx, "Property", s(session.propertyAddress));
    scratchField(ctx, "Co-operating Commission", s(session.coopCommission));
    scratchField(ctx, "Buyer's Brokerage", s(session.buyerBrokerageName));
    scratchField(ctx, "Buyer's Agent", s(session.buyerAgentName));
    return doc.save();
  });
}

// ─── Form 801 — Offer Summary Document ───────────────────────────────────────
// Field coordinates (verified + corrected from overlay preview, +15 pts each):
//   REAL PROPERTY ADDRESS  y≈610 x≈160 (maxWidth 380)
//   Agreement dated day    y≈587 x≈155   month y≈587 x≈380   yr y≈587 x≈560
//   BROKERAGE (buyer's)    y≈568 x≈100 (maxWidth 460)
//   SALES REP              y≈553 x≈100 (maxWidth 460)
//   I/We (Buyer names)     y≈535 x≈90  (maxWidth 460)
//   SELLER(S)              y≈270 x≈90  (maxWidth 460)
//   LISTING BROKERAGE      y≈220 x≈100 (maxWidth 460)
//   LISTING SALES REP      y≈202 x≈100 (maxWidth 460)

export async function generateForm801(session: TransactionSession): Promise<Uint8Array> {
  const buyerNames = session.buyers.map((b) => b.name).join(", ");
  const today = new Date();
  const dd = String(today.getDate());
  const mm = today.toLocaleString("en-CA", { month: "long" });
  const yyyy = String(today.getFullYear());

  const overlays: Overlay[] = [
    // Real property address
    { page: 1, x: 160, y: 610, text: s(session.propertyAddress), maxWidth: 380 },
    // Agreement dated
    { page: 1, x: 155, y: 587, text: dd },
    { page: 1, x: 380, y: 587, text: mm },
    { page: 1, x: 560, y: 587, text: yyyy.slice(2) },
    // Buyer's brokerage
    { page: 1, x: 100, y: 568, text: s(session.buyerBrokerageName), maxWidth: 460 },
    // Sales rep / agent — "SALES REPRESENTATIVE/BROKER:" label ends at ~x=230
    { page: 1, x: 240, y: 553, text: s(session.buyerAgentName), maxWidth: 320 },
    // Buyer names
    { page: 1, x: 90, y: 535, text: buyerNames, maxWidth: 460 },
    // Seller
    { page: 1, x: 90, y: 270, text: s(session.listingBrokerageName, "As per listing"), maxWidth: 460 },
    // Listing brokerage
    { page: 1, x: 100, y: 220, text: s(session.listingBrokerageName), maxWidth: 460 },
  ];

  return overlayOnTemplate("form801.pdf", overlays, async () => {
    const { doc, ctx } = await scratchDoc();
    scratchLine(ctx, "OFFER SUMMARY DOCUMENT", { bold: true, size: 14 });
    scratchLine(ctx, "Form 801 — Ontario Real Estate Association", { size: 9 });
    ctx.y -= 8; scratchDivider(ctx);
    scratchField(ctx, "Property Address", s(session.propertyAddress));
    scratchField(ctx, "Buyer(s)", buyerNames);
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
  });
}
