import { Router } from "express";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { renderTemplatePages } from "../services/pdfRenderer.js";

const router = Router();

// Renders template via pdftoppm (bypasses encryption), overlays coordinate grid
router.get("/mapper/:form", async (req, res) => {
  const formName = req.params.form + ".pdf";

  try {
    const pages = await renderTemplatePages(formName);
    if (pages.length === 0) {
      res.status(404).send("Template not found or could not be rendered");
      return;
    }

    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);

    for (let i = 0; i < pages.length; i++) {
      const { pngBytes, width, height } = pages[i]!;
      const embedded = await doc.embedPng(pngBytes);
      const page = doc.addPage([width, height]);
      page.drawImage(embedded, { x: 0, y: 0, width, height });

      const step = 50;
      const labelSize = 6;

      for (let x = 0; x <= width; x += step) {
        page.drawLine({ start: { x, y: 0 }, end: { x, y: height }, thickness: 0.4, color: rgb(0.5, 0.5, 1), opacity: 0.6 });
        page.drawText(String(x), { x: x + 1, y: height - 10, size: labelSize, font, color: rgb(0, 0, 0.9), opacity: 0.9 });
      }

      for (let y = 0; y <= height; y += step) {
        page.drawLine({ start: { x: 0, y }, end: { x: width, y }, thickness: 0.4, color: rgb(1, 0.4, 0.4), opacity: 0.6 });
        page.drawText(String(Math.round(y)), { x: 2, y: y + 1, size: labelSize, font, color: rgb(0.9, 0, 0), opacity: 0.9 });
      }

      page.drawText(`Page ${i + 1}/${pages.length} — ${formName} — ${width}×${height} pts`, {
        x: 10, y: height - 20, size: 7, font, color: rgb(0, 0, 0), opacity: 0.7,
      });
    }

    const outBytes = await doc.save();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="mapper_${formName}"`);
    res.send(Buffer.from(outBytes));
  } catch (err) {
    res.status(500).send(String(err));
  }
});

// HTML page to view all mappers
router.get("/mapper", (_req, res) => {
  const forms = ["form100", "form300", "form320", "form801", "scheduleA"];
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<title>PDF Field Mapper</title>
<style>
body{font-family:sans-serif;padding:20px;background:#f5f5f5}
h1{font-size:18px;margin-bottom:16px}
.links{display:flex;gap:12px;flex-wrap:wrap}
a{background:#fff;border:1px solid #ddd;border-radius:8px;padding:10px 16px;text-decoration:none;color:#333;font-size:13px}
a:hover{border-color:#3b82f6;color:#3b82f6}
iframe{width:100%;height:900px;border:1px solid #ccc;margin-top:20px;border-radius:8px;background:#fff}
</style></head><body>
<h1>📐 PDF Field Coordinate Mapper</h1>
<div class="links">
${forms.map(f => `<a href="/api/mapper/${f}" target="viewer">${f}.pdf</a>`).join("")}
</div>
<iframe name="viewer" src="/api/mapper/form300"></iframe>
</body></html>`);
});

export default router;
