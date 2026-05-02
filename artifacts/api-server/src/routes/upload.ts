import { Router } from "express";
import multer from "multer";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.resolve(__dirname, "../../forms/templates");

fs.mkdirSync(TEMPLATES_DIR, { recursive: true });

const ALLOWED_FORMS: Record<string, string> = {
  form100: "form100.pdf",
  form300: "form300.pdf",
  form320: "form320.pdf",
  form801: "form801.pdf",
  scheduleA: "scheduleA.pdf",
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, TEMPLATES_DIR),
  filename: (req, _file, cb) => {
    const formKey = req.body?.formKey as string | undefined;
    const filename = formKey && ALLOWED_FORMS[formKey] ? ALLOWED_FORMS[formKey]! : null;
    if (!filename) return cb(new Error("Invalid form key"), "");
    cb(null, filename);
  },
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf" || file.originalname.endsWith(".pdf")) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed"));
    }
  },
  limits: { fileSize: 20 * 1024 * 1024 },
});

const router = Router();

function getFormStatus() {
  return Object.entries(ALLOWED_FORMS).map(([key, filename]) => ({
    key,
    filename,
    exists: fs.existsSync(path.join(TEMPLATES_DIR, filename)),
    size: (() => {
      try {
        return Math.round(fs.statSync(path.join(TEMPLATES_DIR, filename)).size / 1024);
      } catch {
        return 0;
      }
    })(),
  }));
}

router.get("/upload", (_req, res) => {
  const forms = getFormStatus();

  const labels: Record<string, { name: string; desc: string }> = {
    form100: { name: "Form 100", desc: "Agreement of Purchase and Sale" },
    form300: { name: "Form 300", desc: "Buyer Representation Agreement" },
    form320: { name: "Form 320", desc: "Confirmation of Co-operation and Representation" },
    form801: { name: "Form 801", desc: "Offer Summary Document" },
    scheduleA: { name: "Schedule A", desc: "Conditions and Clauses Template" },
  };

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Upload OREA Form Templates</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;padding:32px 16px;color:#1a1a1a}
    h1{font-size:22px;font-weight:700;margin-bottom:4px;text-align:center}
    .subtitle{color:#666;font-size:14px;margin-bottom:32px;text-align:center}
    .cards{display:grid;gap:16px;max-width:640px;margin:0 auto}
    .card{background:#fff;border-radius:12px;padding:20px 24px;border:1px solid #e5e5e5;box-shadow:0 1px 3px rgba(0,0,0,.06)}
    .card-header{display:flex;align-items:center;gap:12px;margin-bottom:14px}
    .badge{font-size:11px;font-weight:600;padding:3px 8px;border-radius:20px;margin-left:auto;white-space:nowrap}
    .badge.ok{background:#d1fae5;color:#065f46}
    .badge.missing{background:#fee2e2;color:#991b1b}
    .form-name{font-weight:600;font-size:15px}
    .form-desc{font-size:13px;color:#666}
    .drop-zone{border:2px dashed #d1d5db;border-radius:8px;padding:18px;text-align:center;cursor:pointer;transition:border-color .2s,background .2s;font-size:13px;color:#6b7280}
    .drop-zone:hover,.drop-zone.drag-over{border-color:#3b82f6;background:#eff6ff;color:#1d4ed8}
    .progress{margin-top:10px;font-size:13px;font-weight:500}
    .progress.success{color:#059669}
    .progress.error{color:#dc2626}
  </style>
</head>
<body>
  <h1>📂 Upload OREA Form Templates</h1>
  <p class="subtitle">Upload your licensed PDF forms. They will be used automatically when generating documents.</p>
  <div class="cards">
    ${forms.map(({ key, exists, size }) => {
      const label = labels[key] ?? { name: key, desc: "" };
      return `<div class="card">
      <div class="card-header">
        <div>
          <div class="form-name">${label.name}</div>
          <div class="form-desc">${label.desc}</div>
        </div>
        <span class="badge ${exists ? "ok" : "missing"}" id="badge-${key}">
          ${exists ? `✓ Uploaded (${size} KB)` : "Missing"}
        </span>
      </div>
      <div class="drop-zone" id="zone-${key}"
           ondragover="event.preventDefault();this.classList.add('drag-over')"
           ondragleave="this.classList.remove('drag-over')"
           ondrop="handleDrop(event,'${key}')"
           onclick="document.getElementById('file-${key}').click()">
        <input type="file" id="file-${key}" accept=".pdf" style="display:none" onchange="handleFile(this,'${key}')"/>
        ${exists ? "✓ Uploaded — click or drop to replace" : "Drop PDF here or click to choose"}
      </div>
      <div class="progress" id="progress-${key}"></div>
    </div>`;
    }).join("")}
  </div>
  <script>
    function handleDrop(e,key){
      e.preventDefault();
      document.getElementById('zone-'+key).classList.remove('drag-over');
      const file=e.dataTransfer.files[0];
      if(file) uploadFile(file,key);
    }
    function handleFile(input,key){
      if(input.files[0]) uploadFile(input.files[0],key);
    }
    async function uploadFile(file,key){
      const prog=document.getElementById('progress-'+key);
      prog.className='progress';
      prog.textContent='⏳ Uploading '+file.name+' ...';
      const form=new FormData();
      form.append('formKey',key);
      form.append('pdf',file);
      try{
        const res=await fetch('/api/upload/form',{method:'POST',body:form});
        const data=await res.json();
        if(res.ok){
          prog.className='progress success';
          prog.textContent='✅ '+data.message;
          const badge=document.getElementById('badge-'+key);
          badge.className='badge ok';
          badge.textContent='✓ Uploaded ('+data.sizeKb+' KB)';
          document.getElementById('zone-'+key).firstChild.nextSibling.textContent='✓ Uploaded — click or drop to replace';
        }else{
          prog.className='progress error';
          prog.textContent='❌ '+(data.error??'Upload failed');
        }
      }catch{
        prog.className='progress error';
        prog.textContent='❌ Network error. Please try again.';
      }
    }
  </script>
</body>
</html>`);
});

router.get("/upload/template/:key", (req, res) => {
  const key = req.params.key as string;
  const filename = ALLOWED_FORMS[key];
  if (!filename) { res.status(404).json({ error: "Unknown form key" }); return; }
  const filePath = path.join(TEMPLATES_DIR, filename);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: "Not uploaded yet" }); return; }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  fs.createReadStream(filePath).pipe(res);
});

router.post(
  "/upload/form",
  upload.single("pdf"),
  (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "No file received" });
      return;
    }
    const sizeKb = Math.round(req.file.size / 1024);
    res.json({
      message: `${req.file.filename} saved successfully`,
      sizeKb,
    });
  }
);

export default router;
