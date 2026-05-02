import { Router } from "express";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.resolve(__dirname, "../../forms/templates");

const router = Router();

// Serves a template PDF with a coordinate grid overlaid so we can
// determine exact field positions
router.get("/mapper/:form", async (req, res) => {
  const formName = req.params.form + ".pdf";
  const filePath = path.join(TEMPLATES_DIR, formName);

  if (!fs.existsSync(filePath)) {
    res.status(404).send("Template not found");
    return;
  }

  try {
    const bytes = fs.readFileSync(filePath);
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const font = await doc.embedFont(StandardFonts.Helvetica);

    for (const page of doc.getPages()) {
      const { width, height } = page.getSize();
      const step = 50;
      const labelSize = 6;

      // Vertical lines + x labels
      for (let x = 0; x <= width; x += step) {
        page.drawLine({
          start: { x, y: 0 },
          end: { x, y: height },
          thickness: 0.3,
          color: rgb(0.7, 0.7, 1),
          opacity: 0.5,
        });
        page.drawText(String(x), {
          x: x + 1,
          y: height - 10,
          size: labelSize,
          font,
          color: rgb(0, 0, 0.8),
          opacity: 0.7,
        });
      }

      // Horizontal lines + y labels
      for (let y = 0; y <= height; y += step) {
        page.drawLine({
          start: { x: 0, y },
          end: { x: width, y },
          thickness: 0.3,
          color: rgb(1, 0.7, 0.7),
          opacity: 0.5,
        });
        page.drawText(String(Math.round(y)), {
          x: 2,
          y: y + 1,
          size: labelSize,
          font,
          color: rgb(0.8, 0, 0),
          opacity: 0.7,
        });
      }
    }

    const outBytes = await doc.save();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${formName}"`);
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
