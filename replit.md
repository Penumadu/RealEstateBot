# Ontario Real Estate Forms Bot

A Telegram-based real estate document automation system for Toronto/Ontario agents. The agent chats with a Telegram bot to collect transaction details, and the system automatically generates OREA form packages and tracks them in a dashboard.

## Architecture

- **Monorepo** managed with pnpm workspaces
- **API server** (`artifacts/api-server`) — Express.js backend, Telegram bot, PDF generation, AI clause writing
- **Database** (`lib/db`) — PostgreSQL via Drizzle ORM
- **AI** — OpenAI via Replit AI Integrations (no API key needed)

## Key URLs

| URL | Purpose |
|-----|---------|
| `/api/dashboard` | Transaction dashboard — all generated form packages |
| `/api/upload` | Upload OREA PDF templates |
| `/api/healthz` | Health check |

## Telegram Bot Flow

### Buyer Rep Agreement (Form 300)
1. Agent selects "New Buyer Rep Agreement"
2. Bot collects: buyer count, name/email/phone per buyer, brokerage, agent name, property/area
3. Bot generates Form 300 PDF and sends to Telegram chat
4. Transaction saved to database

### Offer Package (Forms 100, 320, 801, Schedule A)
1. Agent selects "Prepare an Offer"
2. Bot collects: MLS#, property address, offer price, deposit, closing date, irrevocability, brokerages, agent, buyers
3. Bot asks about conditions — agent selects from: Financing, Home Inspection, Status Certificate, Sale of Property, Custom
4. For each condition, bot asks for key details and AI generates a properly-worded OREA clause
5. Agent can confirm, regenerate, or manually edit each clause
6. Bot generates all 4 forms + Schedule A as PDFs in Telegram
7. Transaction saved to database

## Forms Supported

| Form | Description | When Used |
|------|-------------|-----------|
| Form 100 | Agreement of Purchase and Sale | Offer |
| Form 300 | Buyer Representation Agreement | Before showing |
| Form 320 | Confirmation of Co-operation and Representation | Offer |
| Form 801 | Offer Summary Document | Offer |
| Schedule A | Conditions and Clauses | Offer (if conditions exist) |
| RECO Info Guide | Consumer guide (external link) | Before signing |

## PDF Templates

Place OREA PDF templates at: `artifacts/forms/templates/`
Named as: `form100.pdf`, `form300.pdf`, `form320.pdf`, `form801.pdf`, `scheduleA.pdf`

### PDF Generation Strategy (AcroForm direct field filling)

Templates have AcroForm fields (interactive text fields) but are RC4-encrypted (print:yes only). The system uses `qpdf --decrypt` to strip the encryption, producing `*_dec.pdf` files that pdf-lib can fill directly.

**At startup / setup:** run once per new template set:
```
qpdf --decrypt form100.pdf form100_dec.pdf   # (repeat for each form)
```

**`pdfGenerator.ts`** — loads `*_dec.pdf`, fills AcroForm fields by exact field name (e.g. `txtbuyer1`, `txtp_price`, `txtp_closedate_d`), flattens fields, and saves. Merged into one combined package PDF using `mergePdfs()`.

**Field names** were discovered via `PDFDocument.load(decryptedBytes).getForm().getFields()`.

**`pdfRenderer.ts`** — kept for the debug coordinate mapper tool only (`/api/mapper/:form`).

If a decrypted template is unavailable, a clean scratch-pad fallback generates a plain-text PDF.

## Database Schema

- `transactions` — all generated form packages with buyer info, property, offer details, clauses, forms generated
- `conversations` / `messages` — OpenAI conversation history (from template)

## Key Files

```
artifacts/api-server/src/
  bot/
    index.ts          — Telegraf bot, full conversation state machine
    session.ts        — Session/transaction state types
  services/
    clauseGenerator.ts — AI clause writing via OpenAI
    pdfGenerator.ts    — PDF generation (fill templates or generate from scratch)
    transactionStore.ts — DB read/write for transactions
  routes/
    dashboard.ts      — Transaction dashboard HTML
    upload.ts         — PDF template upload with multer
    bot.ts            — Bot status endpoint
  forms/templates/    — Uploaded OREA PDF templates
lib/db/src/schema/
  transactions.ts     — Transaction table schema
```

## Environment Variables / Secrets

| Key | Description |
|-----|-------------|
| `TELEGRAM_BOT_TOKEN` | Telegram bot token from @BotFather |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | Auto-set by Replit AI integration |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | Auto-set by Replit AI integration |
| `DATABASE_URL` | Auto-set by Replit PostgreSQL |
| `SESSION_SECRET` | Express session secret |

## Planned / Next Steps

- SkySlope API integration — push documents and trigger e-signatures automatically
- Multi-user support — separate agent accounts
- Clause library — save and reuse favourite clauses
- Notification when all parties have signed
