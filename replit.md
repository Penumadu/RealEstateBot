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

Upload licensed OREA PDFs at `/api/upload`. Named as:
- `form100.pdf`, `form300.pdf`, `form320.pdf`, `form801.pdf`, `scheduleA.pdf`

Located at: `artifacts/api-server/forms/templates/`

### PDF Generation Strategy (RC4-encrypted templates)

OREA templates are RC4-encrypted (print:yes, copy/change:no), so pdf-lib cannot modify them directly. The system uses a two-step overlay approach:

1. **`pdfRenderer.ts`** — runs `pdftoppm` at 72 DPI (1 pixel = 1 PDF point) to render each template page to PNG images
2. **`pdfGenerator.ts`** — embeds the PNG as page background in a new pdf-lib document, then draws session data as text at pre-mapped field coordinates

Field coordinates were determined from the coordinate-grid mapper (`/api/mapper/:form`) — a debug tool that renders templates with a blue/red grid overlay at 50pt intervals, making it easy to read exact x/y positions for each blank field.

If templates are unavailable, a clean scratch-pad fallback is used for each form.

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
