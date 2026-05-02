import { Router } from "express";
import { PDFDocument } from "pdf-lib";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  generateForm100,
  generateForm300,
  generateForm320,
  generateForm801,
  generateScheduleA,
} from "../services/pdfGenerator.js";

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

// Preview endpoint — generates a form with mock data so we can visually verify overlay positions
const MOCK_SESSION = {
  step: "idle" as const,
  buyers: [
    { name: "John Smith", email: "john@example.com", phone: "416-555-0100" },
    { name: "Jane Smith", email: "jane@example.com", phone: "416-555-0101" },
  ],
  buyerAgentName: "Sarah Johnson",
  buyerBrokerageName: "Royal LePage Terrequity Realty",
  listingBrokerageName: "RE/MAX Hallmark Realty Ltd.",
  propertyAddress: "123 Maple Street, Toronto, ON M5V 2T6",
  mlsNumber: "C12345678",
  offerPrice: "$950,000",
  depositAmount: "$50,000",
  depositPayable: "Listing Brokerage in Trust",
  closingDate: "2025-08-01",
  irrevocabilityDate: "2025-05-10",
  coopCommission: "2.5% + HST",
  conditionTypes: ["financing", "inspection"] as ("financing" | "inspection")[],
  clauses: [
    {
      type: "financing" as const,
      label: "Condition on Financing",
      text: "This Offer is conditional upon the Buyer arranging, at the Buyer's own expense, a new mortgage loan or confirming an existing mortgage, as described below, satisfactory to the Buyer in the Buyer's sole and absolute discretion. Unless the Buyer gives notice in writing delivered to the Seller or the Seller's agent by no later than 11:59 p.m. on the 5th day after acceptance of this Offer that this condition is fulfilled, this Offer shall be null and void and the deposit shall be returned to the Buyer in full without deduction.",
    },
    {
      type: "inspection" as const,
      label: "Condition on Home Inspection",
      text: "This Offer is conditional upon the inspection of the subject property by a home inspector at the Buyer's own expense, and the obtaining of a report satisfactory to the Buyer in the Buyer's sole and absolute discretion. Unless the Buyer gives notice in writing delivered to the Seller or the Seller's agent by no later than 11:59 p.m. on the 5th day after acceptance of this Offer that this condition is fulfilled, this Offer shall be null and void and the deposit shall be returned to the Buyer in full without deduction.",
    },
  ],
};

router.get("/preview/:form", async (req, res) => {
  const form = req.params.form;
  let bytes: Uint8Array;
  try {
    if (form === "form100") bytes = await generateForm100(MOCK_SESSION);
    else if (form === "form300") bytes = await generateForm300(MOCK_SESSION);
    else if (form === "form320") bytes = await generateForm320(MOCK_SESSION);
    else if (form === "form801") bytes = await generateForm801(MOCK_SESSION);
    else if (form === "scheduleA") bytes = await generateScheduleA(MOCK_SESSION);
    else { res.status(404).send("Unknown form"); return; }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="preview_${form}.pdf"`);
    res.send(Buffer.from(bytes));
  } catch (err) {
    res.status(500).send(String(err));
  }
});

export default router;
