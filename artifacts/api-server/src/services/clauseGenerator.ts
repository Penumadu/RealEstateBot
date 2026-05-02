import { openai } from "@workspace/integrations-openai-ai-server";
import type { Clause, ClauseType } from "../bot/session.js";

const SYSTEM_PROMPT = `You are an expert Ontario real estate lawyer specializing in OREA standard forms and Schedule A clauses.
Write legally precise, standard clauses using OREA-approved wording.
Always include:
- The specific condition being waived/fulfilled
- The exact deadline (using the number of Business Days provided)
- The consequence if not fulfilled (offer becomes null and void)
- The waiver option where appropriate

Output ONLY the clause text, no preamble or explanation.`;

type ClauseParams = {
  type: ClauseType;
  offerPrice?: string;
  propertyAddress?: string;
  financingAmount?: string;
  financingDays?: string;
  inspectionDays?: string;
  statusCertDays?: string;
  saleOfPropertyDays?: string;
  customDescription?: string;
};

export async function generateClause(params: ClauseParams): Promise<Clause> {
  let userPrompt = "";
  let label = "";

  switch (params.type) {
    case "financing":
      label = "Financing Condition";
      userPrompt = `Write an OREA-standard financing condition clause for Schedule A with these details:
- Mortgage amount: ${params.financingAmount ?? "to be arranged"}
- Days to fulfill: ${params.financingDays ?? "5"} Business Days after acceptance
- Property: ${params.propertyAddress ?? "the subject property"}
Use standard OREA wording for a new first mortgage at prevailing rates.`;
      break;

    case "inspection":
      label = "Home Inspection Condition";
      userPrompt = `Write an OREA-standard home inspection condition clause for Schedule A with these details:
- Days to fulfill: ${params.inspectionDays ?? "10"} Business Days after acceptance
- Property: ${params.propertyAddress ?? "the subject property"}
The Buyer may arrange an inspection at their own expense and has the right to terminate if not satisfied.`;
      break;

    case "status_certificate":
      label = "Status Certificate Condition";
      userPrompt = `Write an OREA-standard status certificate condition clause for Schedule A (condo purchase) with these details:
- Days to fulfill: ${params.statusCertDays ?? "10"} Business Days after receipt of status certificate
- Property: ${params.propertyAddress ?? "the subject property"}
The Seller must obtain and deliver the status certificate within 10 days of acceptance.`;
      break;

    case "sale_of_property":
      label = "Sale of Buyer's Property Condition";
      userPrompt = `Write an OREA-standard condition on sale of buyer's existing property clause for Schedule A with these details:
- Days to fulfill: ${params.saleOfPropertyDays ?? "30"} days after acceptance
- Property: ${params.propertyAddress ?? "the subject property"}
Include standard escape clause language.`;
      break;

    case "custom":
      label = "Special Condition";
      userPrompt = `Write a properly worded Schedule A condition clause for an Ontario real estate offer based on this description:
${params.customDescription}
Use formal legal language consistent with OREA forms and Ontario real estate practice.`;
      break;
  }

  const response = await openai.chat.completions.create({
    model: "gpt-5.4",
    max_completion_tokens: 1024,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  });

  const text =
    response.choices[0]?.message?.content?.trim() ??
    "Clause could not be generated. Please enter manually.";

  return { type: params.type, label, text };
}
