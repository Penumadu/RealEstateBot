import { logger } from "../lib/logger.js";
import type { TransactionSession } from "../bot/session.js";

const DOCUSEAL_BASE = "https://api.docuseal.com";

function getApiKey(): string {
  const key = process.env["DOCUSEAL_API_KEY"];
  if (!key) throw new Error("DOCUSEAL_API_KEY is not set");
  return key;
}

export type DocuSealSubmitter = {
  name: string;
  email: string;
  role: string;
};

export type DocuSealDocument = {
  name: string;
  fileBase64: string;
};

export type SubmissionResult = {
  submissionId: number;
  signers: { name: string; email: string; signingUrl: string; role: string }[];
};

export async function sendForSignature(
  documents: DocuSealDocument[],
  submitters: DocuSealSubmitter[],
  submissionName: string
): Promise<SubmissionResult> {
  const key = getApiKey();

  const body = {
    name: submissionName,
    send_email: true,
    submitters_order: "preserved",
    documents: documents.map((d) => ({
      name: d.name,
      file: d.fileBase64,
    })),
    submitters: submitters.map((s, i) => ({
      name: s.name,
      email: s.email,
      role: s.role,
      order: i + 1,
    })),
  };

  const res = await fetch(`${DOCUSEAL_BASE}/submissions/pdf`, {
    method: "POST",
    headers: {
      "X-Auth-Token": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    logger.error({ status: res.status, body: text }, "DocuSeal API error");
    throw new Error(`DocuSeal error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    id?: number;
    submitters?: {
      id: number;
      name: string;
      email: string;
      role: string;
      slug: string;
    }[];
  }[];

  const firstResult = Array.isArray(data) ? data[0] : data;
  const submissionId = (firstResult as { id?: number }).id ?? 0;
  const returnedSubmitters = (firstResult as { submitters?: { id: number; name: string; email: string; role: string; slug: string }[] }).submitters ?? [];

  const signers = returnedSubmitters.map((sub) => ({
    name: sub.name,
    email: sub.email,
    role: sub.role,
    signingUrl: `https://docuseal.com/s/${sub.slug}`,
  }));

  return { submissionId, signers };
}

export function buildSubmittersFromSession(
  session: TransactionSession
): DocuSealSubmitter[] {
  const submitters: DocuSealSubmitter[] = [];

  session.buyers.forEach((buyer, i) => {
    submitters.push({
      name: buyer.name,
      email: buyer.email,
      role: session.buyers.length > 1 ? `Buyer ${i + 1}` : "Buyer",
    });
  });

  if (session.buyerAgentName && session.agentEmail) {
    submitters.push({
      name: session.buyerAgentName,
      email: session.agentEmail,
      role: "Buyer's Agent",
    });
  }

  return submitters;
}

export function buildDocumentsFromPdfs(
  pdfs: { name: string; bytes: Uint8Array }[]
): DocuSealDocument[] {
  return pdfs.map((p) => ({
    name: p.name,
    fileBase64: Buffer.from(p.bytes).toString("base64"),
  }));
}
