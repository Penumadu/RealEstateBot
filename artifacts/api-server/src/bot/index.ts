import { Telegraf, Markup } from "telegraf";
import { message } from "telegraf/filters";
import { logger } from "../lib/logger.js";
import {
  createSession,
  type TransactionSession,
  type ClauseType,
} from "./session.js";
import { generateClause } from "../services/clauseGenerator.js";
import {
  generateForm300,
  generateForm100,
  generateScheduleA,
  generateForm320,
  generateForm801,
} from "../services/pdfGenerator.js";
import { saveTransaction } from "../services/transactionStore.js";
import {
  sendForSignature,
  buildSubmittersFromSession,
  buildDocumentsFromPdfs,
} from "../services/docuseal.js";
import { fetchPropertyByMls } from "../services/repliers.js";

const sessions = new Map<number, TransactionSession>();

function getSession(chatId: number): TransactionSession {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, createSession());
  }
  return sessions.get(chatId)!;
}

function resetSession(chatId: number): TransactionSession {
  const s = createSession();
  sessions.set(chatId, s);
  return s;
}

const CLAUSE_OPTIONS: { type: ClauseType; label: string; emoji: string }[] = [
  { type: "financing", label: "Financing", emoji: "🏦" },
  { type: "inspection", label: "Home Inspection", emoji: "🔍" },
  { type: "status_certificate", label: "Status Certificate (Condo)", emoji: "📋" },
  { type: "sale_of_property", label: "Sale of Buyer's Property", emoji: "🏠" },
  { type: "custom", label: "Custom Clause", emoji: "✏️" },
];

export function createBot(token: string): Telegraf {
  const bot = new Telegraf(token);

  const showMainMenu = async (ctx: { reply: (text: string, extra?: object) => Promise<unknown> }) => {
    await ctx.reply(
      "📋 *Available Form Types*\n\n" +
      "1️⃣ *Buyer Rep Agreement — Form 300*\n" +
      "   Set up buyer representation. Collects buyer info, brokerage, agent name, and property area.\n\n" +
      "2️⃣ *Full Offer Package — Forms 100, 320, 801 + Schedule A*\n" +
      "   Prepare a complete offer. Includes purchase agreement, co-operation confirmation, offer summary, and AI-written condition clauses.\n\n" +
      "Tap a button below or type *1* or *2* to get started:",
      {
        parse_mode: "Markdown",
        ...Markup.keyboard([
          ["1️⃣ Buyer Rep Agreement (Form 300)"],
          ["2️⃣ Full Offer Package (Forms 100, 320, 801, Schedule A)"],
        ]).resize(),
      }
    );
  };

  bot.start(async (ctx) => {
    resetSession(ctx.chat.id);
    await ctx.reply(
      "👋 *Welcome to the Ontario Real Estate Forms Bot!*\n\n" +
      "I help Ontario real estate agents prepare OREA form packages and send them for e-signature via DocuSeal.\n\n" +
      "📄 Forms I can generate:\n" +
      "• Form 100 — Agreement of Purchase and Sale\n" +
      "• Form 300 — Buyer Representation Agreement\n" +
      "• Form 320 — Confirmation of Co-operation\n" +
      "• Form 801 — Offer Summary Document\n" +
      "• Schedule A — AI-written condition clauses\n\n" +
      "🔍 MLS auto-lookup powered by Repliers\n" +
      "✍️ E-signatures via DocuSeal",
      { parse_mode: "Markdown" }
    );
    await showMainMenu(ctx);
  });

  bot.command("menu", async (ctx) => {
    resetSession(ctx.chat.id);
    await showMainMenu(ctx);
  });

  bot.on(message("text"), async (ctx) => {
    const chatId = ctx.chat.id;
    const s = getSession(chatId);
    const text = ctx.message.text.trim();

    // Skip command messages — they are handled by their own handlers
    if (text.startsWith("/")) return;

    logger.info({ text, step: s.step }, "Bot received message");

    const tl = text.toLowerCase();

    // Handle main menu selections — number shortcuts only when idle, button labels always
    const isIdle = s.step === "idle";
    if (tl.includes("buyer rep") || tl.includes("form 300") || tl.startsWith("1️⃣") || (isIdle && tl === "1")) {
      const ns = resetSession(chatId);
      ns.formType = "buyer_rep";
      ns.step = "buyer_rep_count";
      await ctx.reply(
        "Let's set up the Buyer Representation Agreement.\n\nHow many buyers are on this agreement?",
        Markup.keyboard([["1", "2", "3"]]).oneTime().resize()
      );
      return;
    }

    if (tl.includes("prepare an offer") || tl.includes("offer package") || tl.includes("forms 100") || tl.includes("full offer") || tl.startsWith("2️⃣") || (isIdle && tl === "2")) {
      const ns = resetSession(chatId);
      ns.formType = "offer";
      ns.step = "offer_mls";
      await ctx.reply(
        "Let's prepare the offer package.\n\nPlease enter the MLS number:",
        Markup.removeKeyboard()
      );
      return;
    }

    try {
      await handleStep(ctx, s, text, chatId);
    } catch (err) {
      logger.error({ err }, "Bot step error");
      await ctx.reply("⚠️ Something went wrong. Type /start to begin again.");
    }
  });

  return bot;
}

async function handleStep(
  ctx: { reply: (text: string, extra?: object) => Promise<unknown>; replyWithDocument: (doc: object, extra?: object) => Promise<unknown> },
  s: TransactionSession,
  text: string,
  chatId?: number
): Promise<void> {
  switch (s.step) {

    case "buyer_rep_count": {
      const count = parseInt(text);
      if (isNaN(count) || count < 1 || count > 5) {
        await ctx.reply("Please enter a number between 1 and 5.");
        return;
      }
      s.buyers = [];
      for (let i = 0; i < count; i++) s.buyers.push({ name: "", email: "", phone: "" });
      s.step = "buyer_rep_name_0";
      await ctx.reply(`Enter the full name of Buyer 1:`, Markup.removeKeyboard());
      break;
    }

    case "buyer_rep_brokerage":
      s.buyerBrokerageName = text;
      s.step = "buyer_rep_agent";
      await ctx.reply("Enter the buyer's agent full name:");
      break;

    case "buyer_rep_agent":
      s.buyerAgentName = text;
      s.step = "buyer_rep_property";
      await ctx.reply(
        "Enter the property address or area of interest:",
        Markup.keyboard([["🏙️ TBD — Area Not Yet Specified"]]).resize()
      );
      break;

    case "buyer_rep_property": {
      const isTbd = text === "TBD" || text.includes("TBD") || text.toLowerCase().includes("area not yet");
      s.propertyAddress = isTbd ? undefined : text.replace(/[\r\n]+/g, ", ").replace(/\s+/g, " ").trim();
      await ctx.reply("⏳ Generating Form 300...");
      const pdf = await generateForm300(s);
      await ctx.replyWithDocument(
        { source: Buffer.from(pdf), filename: "Form300_BuyerRepAgreement.pdf" },
        { caption: "✅ Form 300 — Buyer Representation Agreement" }
      );
      await saveTransaction(chatId ?? 0, s, ["Form 300"]).catch(() => {});
      s.pendingPdfs = [{ name: "Form 300 — Buyer Representation Agreement", bytes: pdf }];
      s.step = "sign_agent_email";
      await ctx.reply(
        "Send for e-signatures via DocuSeal?\n\nEnter your email to be included as a signer:",
        Markup.keyboard([["⏭️ Skip — I'll send manually"]]).resize()
      );
      break;
    }

    case "sign_agent_email": {
      const isSkip = text.toLowerCase().includes("skip") || text.toLowerCase() === "skip";
      if (!isSkip) {
        s.agentEmail = text;
      }
      s.step = "sign_confirm";
      const signerList = [
        ...s.buyers.map((b) => `• ${b.name} — ${b.email} (Buyer)`),
        ...(s.agentEmail ? [`• ${s.buyerAgentName ?? "Agent"} — ${s.agentEmail} (Buyer's Agent)`] : []),
      ].join("\n");
      await ctx.reply(
        `Signature requests will be sent to:\n\n${signerList}\n\nSend now?`,
        Markup.keyboard([["✅ Yes — Send for Signatures", "⏭️ Skip — I'll handle manually"]]).oneTime().resize()
      );
      break;
    }

    case "sign_confirm": {
      if (text === "✅ Yes — Send for Signatures") {
        await ctx.reply("⏳ Sending to DocuSeal...");
        try {
          const pdfs = s.pendingPdfs ?? [];
          const submitters = buildSubmittersFromSession(s);
          if (s.agentEmail && s.buyerAgentName) {
            const existing = submitters.find(sub => sub.role === "Buyer's Agent");
            if (existing) existing.email = s.agentEmail;
            else submitters.push({ name: s.buyerAgentName, email: s.agentEmail, role: "Buyer's Agent" });
          }
          const docs = buildDocumentsFromPdfs(pdfs);
          const property = s.propertyAddress ?? s.mlsNumber ?? "Transaction";
          const result = await sendForSignature(docs, submitters, `${property} — OREA Forms`);
          const signerLines = result.signers.map(sig =>
            `• ${sig.name} (${sig.role}): ${sig.signingUrl}`
          ).join("\n");
          await ctx.reply(
            `✅ Sent! Signature requests emailed to all parties.\n\nSigning links:\n${signerLines}`,
            Markup.keyboard([
              ["1️⃣ Buyer Rep Agreement (Form 300)"],
              ["2️⃣ Full Offer Package (Forms 100, 320, 801, Schedule A)"],
            ]).resize()
          );
        } catch (err) {
          logger.error({ err }, "DocuSeal send error");
          await ctx.reply(
            "⚠️ Could not send via DocuSeal. Please send the PDFs manually.",
            Markup.keyboard([
              ["1️⃣ Buyer Rep Agreement (Form 300)"],
              ["2️⃣ Full Offer Package (Forms 100, 320, 801, Schedule A)"],
            ]).resize()
          );
        }
      } else {
        await ctx.reply(
          "No problem — the PDFs are ready to send manually. What would you like to do next?",
          Markup.keyboard([
            ["1️⃣ Buyer Rep Agreement (Form 300)"],
            ["2️⃣ Full Offer Package (Forms 100, 320, 801, Schedule A)"],
          ]).resize()
        );
      }
      s.pendingPdfs = undefined;
      s.agentEmail = undefined;
      s.step = "idle";
      break;
    }

    case "offer_mls": {
      s.mlsNumber = text;
      await ctx.reply("🔍 Looking up MLS listing...");
      const property = await fetchPropertyByMls(text);
      if (property) {
        s.propertyAddress = property.address;
        s.listPrice = property.listPrice;
        if (property.listingBrokerageName) s.listingBrokerageName = property.listingBrokerageName;
        if (property.coopCommission) s.coopCommission = property.coopCommission;
        s.step = "offer_mls_confirm";
        const lines = [
          `📍 *${property.address}*`,
          `💰 List Price: ${property.listPrice || "N/A"}`,
          property.listingBrokerageName ? `🏢 Listing Brokerage: ${property.listingBrokerageName}` : null,
          property.coopCommission ? `🤝 Co-op Commission: ${property.coopCommission}` : null,
        ].filter(Boolean).join("\n");
        await ctx.reply(
          `✅ Listing found!\n\n${lines}\n\nIs this the correct property?`,
          {
            parse_mode: "Markdown",
            ...Markup.keyboard([["✅ Yes, correct", "❌ No, enter manually"]]).oneTime().resize(),
          }
        );
      } else {
        s.step = "offer_address";
        await ctx.reply(
          "ℹ️ Couldn't find that MLS number automatically. Let's enter the details manually.\n\nEnter the property address:",
          Markup.removeKeyboard()
        );
      }
      break;
    }

    case "offer_mls_confirm": {
      if (text === "✅ Yes, correct") {
        s.step = "offer_price";
        const hint = s.listPrice ? ` (list price is ${s.listPrice})` : "";
        await ctx.reply(
          `Enter your offer price${hint}:`,
          Markup.removeKeyboard()
        );
      } else {
        s.propertyAddress = undefined;
        s.listPrice = undefined;
        s.listingBrokerageName = undefined;
        s.coopCommission = undefined;
        s.step = "offer_address";
        await ctx.reply("Enter the property address:", Markup.removeKeyboard());
      }
      break;
    }

    case "offer_address":
      s.propertyAddress = text.replace(/[\r\n]+/g, ", ").replace(/\s+/g, " ").trim();
      s.step = "offer_price";
      await ctx.reply("Enter the offer price (e.g. $850,000):");
      break;

    case "offer_price":
      s.offerPrice = text;
      s.step = "offer_deposit";
      await ctx.reply("Enter the deposit amount (e.g. $25,000):");
      break;

    case "offer_deposit":
      s.depositAmount = text;
      s.step = "offer_deposit_payable";
      await ctx.reply(
        "Deposit payable to:",
        Markup.keyboard([
          ["Listing Brokerage in Trust"],
          ["Seller's Lawyer in Trust"],
          ["Buyer's Lawyer in Trust"],
          ["✏️ Other..."],
        ]).resize()
      );
      break;

    case "offer_deposit_payable":
      if (text === "✏️ Other...") {
        s.step = "offer_deposit_payable_custom";
        await ctx.reply("Type who the deposit is payable to:", Markup.removeKeyboard());
        break;
      }
      s.depositPayable = text;
      s.step = "offer_closing";
      await ctx.reply(
        "Enter the closing / completion date:\n_e.g. June 30, 2025_",
        { parse_mode: "Markdown", ...Markup.removeKeyboard() }
      );
      break;

    case "offer_deposit_payable_custom":
      s.depositPayable = text;
      s.step = "offer_closing";
      await ctx.reply(
        "Enter the closing / completion date:\n_e.g. June 30, 2025_",
        { parse_mode: "Markdown", ...Markup.removeKeyboard() }
      );
      break;

    case "offer_closing":
      s.closingDate = text;
      s.step = "offer_irrevocability";
      await ctx.reply(
        "Enter the irrevocability date & time:\n_e.g. May 10, 2025 at 11:59 PM_",
        { parse_mode: "Markdown", ...Markup.removeKeyboard() }
      );
      break;

    case "offer_irrevocability":
      s.irrevocabilityDate = text;
      if (s.listingBrokerageName) {
        s.step = "offer_buyer_brokerage";
        await ctx.reply(
          `Listing brokerage auto-filled: *${s.listingBrokerageName}*\n\nEnter the buyer's brokerage name:`,
          { parse_mode: "Markdown", ...Markup.removeKeyboard() }
        );
      } else {
        s.step = "offer_listing_brokerage";
        await ctx.reply("Enter the listing brokerage name:");
      }
      break;

    case "offer_listing_brokerage":
      s.listingBrokerageName = text;
      s.step = "offer_buyer_brokerage";
      await ctx.reply("Enter the buyer's brokerage name:");
      break;

    case "offer_buyer_brokerage":
      s.buyerBrokerageName = text;
      s.step = "offer_buyer_agent";
      await ctx.reply("Enter the buyer's agent full name:");
      break;

    case "offer_buyer_agent":
      s.buyerAgentName = text;
      if (s.coopCommission) {
        s.step = "offer_buyers_count";
        await ctx.reply(
          `Co-op commission auto-filled: *${s.coopCommission}*\n\nHow many buyers are on this offer?`,
          {
            parse_mode: "Markdown",
            ...Markup.keyboard([["1", "2", "3"]]).oneTime().resize(),
          }
        );
      } else {
        s.step = "offer_coop_commission";
        await ctx.reply(
          "Enter the co-operating commission:",
          Markup.keyboard([
            ["2.5% of sale price", "2% of sale price"],
            ["3% of sale price", "1% of sale price"],
            ["✏️ Other..."],
          ]).resize()
        );
      }
      break;

    case "offer_coop_commission":
      if (text === "✏️ Other...") {
        s.step = "offer_coop_commission_custom";
        await ctx.reply("Type the co-operating commission:", Markup.removeKeyboard());
        break;
      }
      s.coopCommission = text;
      s.step = "offer_buyers_count";
      await ctx.reply(
        "How many buyers are on this offer?",
        Markup.keyboard([["1", "2", "3"]]).resize()
      );
      break;

    case "offer_coop_commission_custom":
      s.coopCommission = text;
      s.step = "offer_buyers_count";
      await ctx.reply(
        "How many buyers are on this offer?",
        Markup.keyboard([["1", "2", "3"]]).resize()
      );
      break;

    case "offer_buyers_count": {
      const count = parseInt(text);
      if (isNaN(count) || count < 1 || count > 5) {
        await ctx.reply("Please enter a number between 1 and 5.");
        return;
      }
      s.buyers = [];
      for (let i = 0; i < count; i++) s.buyers.push({ name: "", email: "", phone: "" });
      s.step = "offer_buyer_name_0";
      await ctx.reply(`Enter the full name of Buyer 1:`, Markup.removeKeyboard());
      break;
    }

    case "offer_conditions": {
      s.step = "offer_select_clauses";
      await ctx.reply(
        "Which conditions are you including?\n\nTap one at a time, then tap *Done* when finished:",
        {
          parse_mode: "Markdown",
          ...Markup.keyboard([
            ["🏦 Financing", "🔍 Home Inspection"],
            ["📋 Status Certificate (Condo)", "🏠 Sale of Buyer's Property"],
            ["✏️ Custom Clause", "✅ Done — No More Conditions"],
          ]).resize(),
        }
      );
      break;
    }

    case "offer_select_clauses":
      await handleClauseSelection(ctx, s, text);
      break;

    case "offer_financing_amount":
      s.financingAmount = text;
      s.step = "offer_financing_days";
      await ctx.reply(
        "How many Business Days for the financing condition?",
        Markup.keyboard([["5", "7", "10"], ["14", "21"], ["✏️ Other..."]]).resize()
      );
      break;

    case "offer_financing_days":
      if (text === "✏️ Other...") {
        s.step = "offer_financing_days_custom";
        await ctx.reply("Type the number of Business Days for financing:", Markup.removeKeyboard());
        break;
      }
      s.financingDays = text;
      await generateAndAddClause(ctx, s, "financing");
      break;

    case "offer_financing_days_custom":
      s.financingDays = text;
      await generateAndAddClause(ctx, s, "financing");
      break;

    case "offer_inspection_days":
      if (text === "✏️ Other...") {
        s.step = "offer_inspection_days_custom";
        await ctx.reply("Type the number of Business Days for inspection:", Markup.removeKeyboard());
        break;
      }
      s.inspectionDays = text;
      await generateAndAddClause(ctx, s, "inspection");
      break;

    case "offer_inspection_days_custom":
      s.inspectionDays = text;
      await generateAndAddClause(ctx, s, "inspection");
      break;

    case "offer_status_cert_days":
      if (text === "✏️ Other...") {
        s.step = "offer_status_cert_days_custom";
        await ctx.reply("Type the number of Business Days for status certificate review:", Markup.removeKeyboard());
        break;
      }
      s.statusCertDays = text;
      await generateAndAddClause(ctx, s, "status_certificate");
      break;

    case "offer_status_cert_days_custom":
      s.statusCertDays = text;
      await generateAndAddClause(ctx, s, "status_certificate");
      break;

    case "offer_sale_of_property_days":
      if (text === "✏️ Other...") {
        s.step = "offer_sale_of_property_days_custom";
        await ctx.reply("Type the number of days for the sale of property condition:", Markup.removeKeyboard());
        break;
      }
      s.saleOfPropertyDays = text;
      await generateAndAddClause(ctx, s, "sale_of_property");
      break;

    case "offer_sale_of_property_days_custom":
      s.saleOfPropertyDays = text;
      await generateAndAddClause(ctx, s, "sale_of_property");
      break;

    case "offer_custom_description":
      s.customClauseDescription = text;
      await generateAndAddClause(ctx, s, "custom");
      break;

    case "offer_clause_confirm": {
      if (text === "✅ Use This Clause") {
        if (s.pendingClause) {
          s.clauses.push(s.pendingClause as unknown as typeof s.clauses[0]);
          s.pendingClause = undefined;
        }
        await returnToClauseSelection(ctx, s);
      } else if (text === "🔄 Regenerate") {
        const type = s.pendingClause?.type;
        if (type) {
          s.pendingClause = undefined;
          await rerunClauseGeneration(ctx, s, type);
        }
      } else if (text === "✏️ Edit Manually") {
        s.step = "offer_clause_manual_edit";
        await ctx.reply("Type the clause text you want to use:", Markup.removeKeyboard());
      }
      break;
    }

    case "offer_clause_manual_edit": {
      if (s.pendingClause) {
        (s.pendingClause as unknown as { text: string }).text = text;
        s.clauses.push(s.pendingClause as unknown as typeof s.clauses[0]);
        s.pendingClause = undefined;
      }
      await returnToClauseSelection(ctx, s);
      break;
    }

    default: {
      const stepMatch = s.step.match(/^(buyer_rep|offer)_buyer(?:_rep)?_name_(\d+)$/);
      const repNameMatch = s.step.match(/^buyer_rep_name_(\d+)$/);
      const offerNameMatch = s.step.match(/^offer_buyer_name_(\d+)$/);
      const repEmailMatch = s.step.match(/^buyer_rep_email_(\d+)$/);
      const offerEmailMatch = s.step.match(/^offer_buyer_email_(\d+)$/);
      const repPhoneMatch = s.step.match(/^buyer_rep_phone_(\d+)$/);
      const offerPhoneMatch = s.step.match(/^offer_buyer_phone_(\d+)$/);

      if (repNameMatch) {
        const i = parseInt(repNameMatch[1]!);
        s.buyers[i]!.name = text;
        s.step = `buyer_rep_email_${i}`;
        await ctx.reply(`Email for ${text}:`);
      } else if (offerNameMatch) {
        const i = parseInt(offerNameMatch[1]!);
        s.buyers[i]!.name = text;
        s.step = `offer_buyer_email_${i}`;
        await ctx.reply(`Email for ${text}:`);
      } else if (repEmailMatch) {
        const i = parseInt(repEmailMatch[1]!);
        s.buyers[i]!.email = text;
        s.step = `buyer_rep_phone_${i}`;
        await ctx.reply(`Phone number for ${s.buyers[i]!.name}:`);
      } else if (offerEmailMatch) {
        const i = parseInt(offerEmailMatch[1]!);
        s.buyers[i]!.email = text;
        s.step = `offer_buyer_phone_${i}`;
        await ctx.reply(`Phone number for ${s.buyers[i]!.name}:`);
      } else if (repPhoneMatch) {
        const i = parseInt(repPhoneMatch[1]!);
        s.buyers[i]!.phone = text;
        const next = i + 1;
        if (next < s.buyers.length) {
          s.step = `buyer_rep_name_${next}`;
          await ctx.reply(`Enter the full name of Buyer ${next + 1}:`);
        } else {
          s.step = "buyer_rep_brokerage";
          await ctx.reply("Enter the buyer's brokerage name:");
        }
      } else if (offerPhoneMatch) {
        const i = parseInt(offerPhoneMatch[1]!);
        s.buyers[i]!.phone = text;
        const next = i + 1;
        if (next < s.buyers.length) {
          s.step = `offer_buyer_name_${next}`;
          await ctx.reply(`Enter the full name of Buyer ${next + 1}:`);
        } else {
          s.step = "offer_conditions";
          await ctx.reply(
            "All buyers added! Does this offer have any conditions?",
            Markup.keyboard([["✅ Yes — Add Conditions", "🔒 No — Firm Offer"]]).resize()
          );
        }
      } else if (s.step === "offer_conditions") {
        if (text.includes("Yes") || text.includes("Add Conditions")) {
          s.step = "offer_select_clauses";
          await ctx.reply(
            "Which conditions are you including?",
            Markup.keyboard([
              ["🏦 Financing", "🔍 Home Inspection"],
              ["📋 Status Certificate (Condo)", "🏠 Sale of Buyer's Property"],
              ["✏️ Custom Clause", "✅ Done — No More Conditions"],
            ]).oneTime().resize()
          );
        } else {
          await generateOfferPackage(ctx, s, chatId);
        }
      } else {
        await ctx.reply(
          "Choose an option below to get started:",
          Markup.keyboard([
            ["📝 New Buyer Rep Agreement (Form 300)"],
            ["📋 Prepare an Offer (Forms 100, 320, 801, Schedule A)"],
          ]).resize()
        );
      }
      void stepMatch;
    }
  }
}

async function handleClauseSelection(
  ctx: { reply: (text: string, extra?: object) => Promise<unknown> },
  s: TransactionSession,
  text: string
): Promise<void> {
  if (text === "✅ Done — No More Conditions") {
    await generateOfferPackage(ctx as Parameters<typeof generateOfferPackage>[0], s, undefined);
    return;
  }

  if (text.includes("Financing")) {
    s.step = "offer_financing_amount";
    await ctx.reply("Enter the financing amount (e.g. $850,000):", Markup.removeKeyboard());
  } else if (text.includes("Home Inspection")) {
    s.step = "offer_inspection_days";
    await ctx.reply(
      "How many Business Days for the inspection condition?",
      Markup.keyboard([["5", "7", "10"], ["14", "21"]]).resize()
    );
  } else if (text.includes("Status Certificate")) {
    s.step = "offer_status_cert_days";
    await ctx.reply(
      "How many Business Days for the status certificate review?",
      Markup.keyboard([["10", "14", "21"], ["30"]]).resize()
    );
  } else if (text.includes("Sale of Buyer")) {
    s.step = "offer_sale_of_property_days";
    await ctx.reply(
      "How many days for the sale of property condition?",
      Markup.keyboard([["30", "60", "90"]]).resize()
    );
  } else if (text.includes("Custom")) {
    s.step = "offer_custom_description";
    await ctx.reply(
      "Describe the custom condition and I'll write the clause:\n(e.g. 'Conditional on buyer obtaining satisfactory soil test within 7 business days')",
      Markup.removeKeyboard()
    );
  } else {
    await ctx.reply(
      "Please select one of the options:",
      Markup.keyboard([
        ["🏦 Financing", "🔍 Home Inspection"],
        ["📋 Status Certificate (Condo)", "🏠 Sale of Buyer's Property"],
        ["✏️ Custom Clause", "✅ Done — No More Conditions"],
      ]).oneTime().resize()
    );
  }
}

async function generateAndAddClause(
  ctx: { reply: (text: string, extra?: object) => Promise<unknown> },
  s: TransactionSession,
  type: ClauseType
): Promise<void> {
  await ctx.reply("⏳ Writing clause...");
  const clause = await generateClause({
    type,
    propertyAddress: s.propertyAddress,
    financingAmount: s.financingAmount,
    financingDays: s.financingDays,
    inspectionDays: s.inspectionDays,
    statusCertDays: s.statusCertDays,
    saleOfPropertyDays: s.saleOfPropertyDays,
    customDescription: s.customClauseDescription,
  });

  s.pendingClause = clause as unknown as TransactionSession["pendingClause"];
  s.step = "offer_clause_confirm";

  await ctx.reply(
    `📄 *${clause.label}*\n\n${clause.text}\n\nWhat would you like to do?`,
    {
      parse_mode: "Markdown",
      ...Markup.keyboard([
        ["✅ Use This Clause", "🔄 Regenerate"],
        ["✏️ Edit Manually"],
      ]).oneTime().resize(),
    }
  );
}

async function rerunClauseGeneration(
  ctx: { reply: (text: string, extra?: object) => Promise<unknown> },
  s: TransactionSession,
  type: ClauseType
): Promise<void> {
  s.step = "offer_clause_confirm";
  await generateAndAddClause(ctx, s, type);
}

async function returnToClauseSelection(
  ctx: { reply: (text: string, extra?: object) => Promise<unknown> },
  s: TransactionSession
): Promise<void> {
  s.step = "offer_select_clauses";
  const added = s.clauses.map((c) => `✓ ${c.label}`).join("\n");
  await ctx.reply(
    `Clause added!\n\n${added}\n\nAdd another condition or finish:`,
    Markup.keyboard([
      ["🏦 Financing", "🔍 Home Inspection"],
      ["📋 Status Certificate (Condo)", "🏠 Sale of Buyer's Property"],
      ["✏️ Custom Clause", "✅ Done — No More Conditions"],
    ]).oneTime().resize()
  );
}

async function generateOfferPackage(
  ctx: {
    reply: (text: string, extra?: object) => Promise<unknown>;
    replyWithDocument: (doc: object, extra?: object) => Promise<unknown>;
  },
  s: TransactionSession,
  chatId?: number
): Promise<void> {
  await ctx.reply("⏳ Generating your offer package — this may take a moment...");

  const [pdf100, pdfSchedA, pdf320, pdf801] = await Promise.all([
    generateForm100(s),
    generateScheduleA(s),
    generateForm320(s),
    generateForm801(s),
  ]);

  await ctx.replyWithDocument(
    { source: Buffer.from(pdf100), filename: "Form100_AgreementOfPurchaseAndSale.pdf" },
    { caption: "📄 Form 100 — Agreement of Purchase and Sale" }
  );

  if (s.clauses.length > 0) {
    await ctx.replyWithDocument(
      { source: Buffer.from(pdfSchedA), filename: "ScheduleA_Conditions.pdf" },
      { caption: "📄 Schedule A — Conditions and Clauses" }
    );
  }

  await ctx.replyWithDocument(
    { source: Buffer.from(pdf320), filename: "Form320_ConfirmationOfCooperation.pdf" },
    { caption: "📄 Form 320 — Confirmation of Co-operation and Representation" }
  );

  await ctx.replyWithDocument(
    { source: Buffer.from(pdf801), filename: "Form801_OfferSummary.pdf" },
    { caption: "📄 Form 801 — Offer Summary Document" }
  );

  const formsGenerated = ["Form 100", "Form 320", "Form 801"];
  if (s.clauses.length > 0) formsGenerated.splice(1, 0, "Schedule A");
  if (chatId) await saveTransaction(chatId, s, formsGenerated).catch(() => {});

  const pendingPdfs = [
    { name: "Form 100 — Agreement of Purchase and Sale", bytes: pdf100 },
    { name: "Form 320 — Confirmation of Co-operation", bytes: pdf320 },
    { name: "Form 801 — Offer Summary Document", bytes: pdf801 },
  ];
  if (s.clauses.length > 0) {
    pendingPdfs.splice(1, 0, { name: "Schedule A — Conditions and Clauses", bytes: pdfSchedA });
  }
  s.pendingPdfs = pendingPdfs;
  s.step = "sign_agent_email";

  await ctx.reply(
    "✅ All forms generated!\n\nSend for e-signatures via DocuSeal?\n\nEnter your (the agent's) email to be included as a signer, or type 'skip':",
    Markup.removeKeyboard()
  );
}
