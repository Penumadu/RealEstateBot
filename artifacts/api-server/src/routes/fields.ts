import { Router } from "express";
import { PDFDocument } from "pdf-lib";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.resolve(__dirname, "../../forms/templates");

const FORMS = ["form100.pdf", "form300.pdf", "form320.pdf", "form801.pdf", "scheduleA.pdf"];

const router = Router();

router.get("/fields", async (_req, res) => {
  const result: Record<string, string[]> = {};

  for (const filename of FORMS) {
    const filePath = path.join(TEMPLATES_DIR, filename);
    if (!fs.existsSync(filePath)) {
      result[filename] = ["NOT UPLOADED"];
      continue;
    }
    try {
      const bytes = fs.readFileSync(filePath);
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const form = doc.getForm();
      const fields = form.getFields().map((f) => `${f.getName()} [${f.constructor.name}]`);
      result[filename] = fields.length > 0 ? fields : ["NO FORM FIELDS FOUND"];
    } catch (err) {
      result[filename] = [`ERROR: ${String(err)}`];
    }
  }

  let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<title>PDF Form Fields</title>
<style>
body{font-family:monospace;padding:24px;background:#f5f5f5}
h1{font-size:18px;margin-bottom:20px}
.form{background:#fff;border:1px solid #ddd;border-radius:8px;padding:16px;margin-bottom:16px}
h2{font-size:14px;font-weight:bold;margin-bottom:8px;color:#333}
ul{margin:0;padding-left:20px}
li{font-size:12px;padding:2px 0;color:#444}
.none{color:#999;font-style:italic}
</style></head><body>
<h1>📋 PDF Form Field Inspector</h1>`;

  for (const [file, fields] of Object.entries(result)) {
    html += `<div class="form"><h2>${file}</h2><ul>`;
    if (fields[0]?.startsWith("NOT") || fields[0]?.startsWith("NO") || fields[0]?.startsWith("ERROR")) {
      html += `<li class="none">${fields[0]}</li>`;
    } else {
      for (const f of fields) html += `<li>${f}</li>`;
    }
    html += `</ul></div>`;
  }

  html += `</body></html>`;
  res.send(html);
});

export default router;
