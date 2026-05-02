import { Router } from "express";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.resolve(__dirname, "../../forms/templates");

const router = Router();

const ALLOWED_FORMS: Record<string, string> = {
  form100: "form100.pdf",
  form300: "form300.pdf",
  form320: "form320.pdf",
  form801: "form801.pdf",
  scheduleA: "scheduleA.pdf",
};

router.get("/upload", (_req, res) => {
  const existing = Object.entries(ALLOWED_FORMS)
    .map(([key, filename]) => {
      const exists = fs.existsSync(path.join(TEMPLATES_DIR, filename));
      return { key, filename, exists };
    });

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Upload OREA Form Templates</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; padding: 32px 16px; color: #1a1a1a; }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
    .subtitle { color: #666; font-size: 14px; margin-bottom: 32px; }
    .cards { display: grid; gap: 16px; max-width: 640px; margin: 0 auto; }
    .card { background: #fff; border-radius: 12px; padding: 20px 24px; border: 1px solid #e5e5e5; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
    .card-header { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
    .badge { font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 20px; }
    .badge.ok { background: #d1fae5; color: #065f46; }
    .badge.missing { background: #fee2e2; color: #991b1b; }
    .form-name { font-weight: 600; font-size: 15px; }
    .form-desc { font-size: 13px; color: #666; }
    .drop-zone { border: 2px dashed #d1d5db; border-radius: 8px; padding: 18px; text-align: center; cursor: pointer; transition: border-color .2s, background .2s; font-size: 13px; color: #6b7280; }
    .drop-zone:hover, .drop-zone.drag-over { border-color: #3b82f6; background: #eff6ff; color: #1d4ed8; }
    .drop-zone input[type=file] { display: none; }
    .progress { margin-top: 10px; font-size: 13px; font-weight: 500; }
    .progress.success { color: #059669; }
    .progress.error { color: #dc2626; }
    h1, .subtitle { text-align: center; }
  </style>
</head>
<body>
  <h1>📂 Upload OREA Form Templates</h1>
  <p class="subtitle">Upload your licensed PDF forms. They will be used automatically when generating documents.</p>
  <div class="cards">
    ${existing.map(({ key, filename, exists }) => {
      const labels: Record<string, { name: string; desc: string }> = {
        form100: { name: "Form 100", desc: "Agreement of Purchase and Sale" },
        form300: { name: "Form 300", desc: "Buyer Representation Agreement" },
        form320: { name: "Form 320", desc: "Confirmation of Co-operation and Representation" },
        form801: { name: "Form 801", desc: "Offer Summary Document" },
        scheduleA: { name: "Schedule A", desc: "Conditions and Clauses Template" },
      };
      const label = labels[key] ?? { name: key, desc: filename };
      return `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="form-name">${label.name}</div>
          <div class="form-desc">${label.desc}</div>
        </div>
        <span class="badge ${exists ? "ok" : "missing"}" style="margin-left:auto">${exists ? "✓ Uploaded" : "Missing"}</span>
      </div>
      <div class="drop-zone" id="zone-${key}"
           ondragover="event.preventDefault();this.classList.add('drag-over')"
           ondragleave="this.classList.remove('drag-over')"
           ondrop="handleDrop(event,'${key}')"
           onclick="document.getElementById('file-${key}').click()">
        <input type="file" id="file-${key}" accept=".pdf" onchange="handleFile(this,'${key}')"/>
        ${exists ? "Re-upload to replace" : "Drop PDF here or click to choose"}
      </div>
      <div class="progress" id="progress-${key}"></div>
    </div>`;
    }).join("")}
  </div>

  <script>
    function handleDrop(e, key) {
      e.preventDefault();
      document.getElementById('zone-' + key).classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) uploadFile(file, key);
    }
    function handleFile(input, key) {
      if (input.files[0]) uploadFile(input.files[0], key);
    }
    async function uploadFile(file, key) {
      const prog = document.getElementById('progress-' + key);
      prog.className = 'progress';
      prog.textContent = '⏳ Uploading...';
      const form = new FormData();
      form.append('pdf', file);
      form.append('formKey', key);
      try {
        const res = await fetch('/api/upload/form', { method: 'POST', body: form });
        const data = await res.json();
        if (res.ok) {
          prog.className = 'progress success';
          prog.textContent = '✅ ' + data.message;
          const badge = document.querySelector('#zone-' + key).closest('.card').querySelector('.badge');
          badge.className = 'badge ok';
          badge.textContent = '✓ Uploaded';
        } else {
          prog.className = 'progress error';
          prog.textContent = '❌ ' + (data.error ?? 'Upload failed');
        }
      } catch {
        prog.className = 'progress error';
        prog.textContent = '❌ Network error. Please try again.';
      }
    }
  </script>
</body>
</html>`);
});

router.post("/upload/form", (req, res) => {
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.includes("multipart/form-data")) {
    res.status(400).json({ error: "Expected multipart/form-data" });
    return;
  }

  const boundary = contentType.split("boundary=")[1];
  if (!boundary) {
    res.status(400).json({ error: "Missing boundary" });
    return;
  }

  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    try {
      const body = Buffer.concat(chunks);
      const bodyStr = body.toString("binary");

      const formKeyMatch = bodyStr.match(/name="formKey"\r\n\r\n([^\r\n]+)/);
      const formKey = formKeyMatch?.[1]?.trim();

      if (!formKey || !ALLOWED_FORMS[formKey]) {
        res.status(400).json({ error: "Invalid form key" });
        return;
      }

      const pdfBoundary = `--${boundary}`;
      const parts = bodyStr.split(pdfBoundary);
      let pdfData: Buffer | null = null;

      for (const part of parts) {
        if (part.includes('name="pdf"') && part.includes("filename=")) {
          const dataStart = part.indexOf("\r\n\r\n") + 4;
          const dataEnd = part.lastIndexOf("\r\n");
          if (dataStart > 4 && dataEnd > dataStart) {
            pdfData = Buffer.from(part.slice(dataStart, dataEnd), "binary");
            break;
          }
        }
      }

      if (!pdfData || pdfData.length === 0) {
        res.status(400).json({ error: "No PDF data found in request" });
        return;
      }

      const filename = ALLOWED_FORMS[formKey]!;
      const destPath = path.join(TEMPLATES_DIR, filename);
      fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
      fs.writeFileSync(destPath, pdfData);

      res.json({
        message: `${filename} saved successfully (${Math.round(pdfData.length / 1024)} KB)`,
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to save file" });
    }
  });
});

export default router;
