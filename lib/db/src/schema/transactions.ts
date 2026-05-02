import { pgTable, serial, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const transactions = pgTable("transactions", {
  id: serial("id").primaryKey(),
  chatId: text("chat_id").notNull(),
  formType: text("form_type").notNull(),
  status: text("status").notNull().default("generated"),
  mlsNumber: text("mls_number"),
  propertyAddress: text("property_address"),
  buyerNames: text("buyer_names").notNull(),
  buyerEmails: text("buyer_emails").notNull(),
  offerPrice: text("offer_price"),
  closingDate: text("closing_date"),
  clauses: jsonb("clauses").default([]),
  formsGenerated: jsonb("forms_generated").default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertTransactionSchema = createInsertSchema(transactions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Transaction = typeof transactions.$inferSelect;
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
