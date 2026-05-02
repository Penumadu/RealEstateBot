import { Router } from "express";
import { getRecentTransactions } from "../services/transactionStore.js";

const router = Router();

router.get("/dashboard", async (_req, res) => {
  try {
    const txns = await getRecentTransactions(50);

    const rows = txns.map((t) => {
      const date = new Date(t.createdAt).toLocaleDateString("en-CA", {
        year: "numeric", month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit",
      });
      const formLabel = t.formType === "buyer_rep"
        ? "📝 Buyer Rep (Form 300)"
        : "📋 Offer Package";
      const statusColor: Record<string, string> = {
        generated: "#d1fae5|#065f46",
        sent: "#dbeafe|#1e40af",
        signed: "#d1fae5|#065f46",
        pending: "#fef3c7|#92400e",
      };
      const [bg, fg] = (statusColor[t.status] ?? "#f3f4f6|#374151").split("|");
      const clauses = Array.isArray(t.clauses) ? t.clauses : [];
      const forms = Array.isArray(t.formsGenerated) ? t.formsGenerated : [];

      return `<tr>
        <td>${t.id}</td>
        <td>${date}</td>
        <td>${formLabel}</td>
        <td>${t.buyerNames}</td>
        <td>${t.buyerEmails}</td>
        <td>${t.propertyAddress ?? "—"}</td>
        <td>${t.mlsNumber ?? "—"}</td>
        <td>${t.offerPrice ?? "—"}</td>
        <td>${t.closingDate ?? "—"}</td>
        <td>${clauses.length > 0 ? (clauses as {label:string}[]).map(c => c.label).join(", ") : "None"}</td>
        <td>${forms.join(", ")}</td>
        <td><span style="background:${bg};color:${fg};padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600">${t.status}</span></td>
      </tr>`;
    }).join("");

    const totalCount = txns.length;
    const buyerReps = txns.filter(t => t.formType === "buyer_rep").length;
    const offers = txns.filter(t => t.formType === "offer").length;

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Real Estate Forms Dashboard</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;color:#1a1a1a}
    header{background:#1e3a5f;color:#fff;padding:20px 32px;display:flex;align-items:center;justify-content:space-between}
    header h1{font-size:20px;font-weight:700}
    header p{font-size:13px;opacity:.8;margin-top:2px}
    .subtitle{font-size:12px;opacity:.7}
    .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding:24px 32px}
    .stat{background:#fff;border-radius:10px;padding:18px 20px;border:1px solid #e5e5e5;box-shadow:0 1px 3px rgba(0,0,0,.05)}
    .stat-value{font-size:28px;font-weight:700;color:#1e3a5f}
    .stat-label{font-size:13px;color:#666;margin-top:2px}
    .section{padding:0 32px 32px}
    .section h2{font-size:16px;font-weight:600;margin-bottom:12px;color:#1e3a5f}
    .table-wrap{overflow-x:auto;border-radius:10px;border:1px solid #e5e5e5;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.05)}
    table{width:100%;border-collapse:collapse;font-size:13px}
    th{background:#f1f5f9;font-weight:600;text-align:left;padding:10px 14px;color:#475569;border-bottom:1px solid #e5e5e5;white-space:nowrap}
    td{padding:10px 14px;border-bottom:1px solid #f1f5f9;vertical-align:top;color:#374151}
    tr:last-child td{border-bottom:none}
    tr:hover td{background:#f8fafc}
    .empty{text-align:center;padding:48px;color:#94a3b8}
    .empty-icon{font-size:36px;margin-bottom:8px}
    .refresh{font-size:12px;color:#94a3b8;margin-top:8px;text-align:right;padding:0 32px 16px}
    a.btn{display:inline-block;background:#1e3a5f;color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:500}
    a.btn:hover{background:#2d5282}
  </style>
</head>
<body>
  <header>
    <div>
      <h1>🏠 Real Estate Forms Dashboard</h1>
      <p class="subtitle">Ontario OREA form packages generated via Telegram bot</p>
    </div>
    <a class="btn" href="/api/upload">📂 Manage Templates</a>
  </header>

  <div class="stats">
    <div class="stat">
      <div class="stat-value">${totalCount}</div>
      <div class="stat-label">Total Transactions</div>
    </div>
    <div class="stat">
      <div class="stat-value">${buyerReps}</div>
      <div class="stat-label">Buyer Rep Agreements</div>
    </div>
    <div class="stat">
      <div class="stat-value">${offers}</div>
      <div class="stat-label">Offer Packages</div>
    </div>
  </div>

  <div class="section">
    <h2>Recent Transactions</h2>
    <div class="table-wrap">
      ${txns.length === 0
        ? `<div class="empty"><div class="empty-icon">📋</div><p>No transactions yet. Start the Telegram bot to generate your first form package.</p></div>`
        : `<table>
        <thead>
          <tr>
            <th>#</th>
            <th>Date</th>
            <th>Form Type</th>
            <th>Buyer(s)</th>
            <th>Email(s)</th>
            <th>Property</th>
            <th>MLS #</th>
            <th>Offer Price</th>
            <th>Closing Date</th>
            <th>Conditions</th>
            <th>Forms</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`}
    </div>
  </div>
  <div class="refresh">Auto-refresh every 30s &nbsp;·&nbsp; <a href="/api/dashboard">Refresh now</a></div>
  <script>setTimeout(()=>location.reload(), 30000)</script>
</body>
</html>`);
  } catch (err) {
    res.status(500).send(`<pre>Dashboard error: ${err}</pre>`);
  }
});

export default router;
