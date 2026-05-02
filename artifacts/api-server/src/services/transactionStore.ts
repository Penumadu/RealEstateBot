import { db } from "@workspace/db";
import { transactions } from "@workspace/db/schema";
import { desc, eq } from "drizzle-orm";
import type { TransactionSession } from "../bot/session.js";

export async function saveTransaction(
  chatId: number,
  session: TransactionSession,
  formsGenerated: string[]
) {
  const buyerNames = session.buyers.map((b) => b.name).join(", ");
  const buyerEmails = session.buyers.map((b) => b.email).join(", ");

  const [row] = await db
    .insert(transactions)
    .values({
      chatId: String(chatId),
      formType: session.formType ?? "unknown",
      status: "generated",
      mlsNumber: session.mlsNumber ?? null,
      propertyAddress: session.propertyAddress ?? null,
      buyerNames,
      buyerEmails,
      offerPrice: session.offerPrice ?? null,
      closingDate: session.closingDate ?? null,
      clauses: session.clauses as unknown as Record<string, unknown>[],
      formsGenerated: formsGenerated as unknown as string[],
    })
    .returning();

  return row;
}

export async function getRecentTransactions(limit = 20) {
  return db
    .select()
    .from(transactions)
    .orderBy(desc(transactions.createdAt))
    .limit(limit);
}

export async function updateTransactionStatus(id: number, status: string) {
  return db
    .update(transactions)
    .set({ status, updatedAt: new Date() })
    .where(eq(transactions.id, id));
}
