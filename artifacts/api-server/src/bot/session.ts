export type Buyer = {
  name: string;
  email: string;
  phone: string;
};

export type ClauseType =
  | "financing"
  | "inspection"
  | "status_certificate"
  | "sale_of_property"
  | "custom";

export type Clause = {
  type: ClauseType;
  label: string;
  text: string;
};

export type PendingPdf = {
  name: string;
  bytes: Uint8Array;
};

export type TransactionSession = {
  step: string;
  formType?: "buyer_rep" | "offer";

  mlsNumber?: string;
  propertyAddress?: string;
  listPrice?: string;

  offerPrice?: string;
  depositAmount?: string;
  depositPayable?: string;
  closingDate?: string;
  irrevocabilityDate?: string;

  buyers: Buyer[];
  buyerAgentName?: string;
  buyerBrokerageName?: string;
  listingBrokerageName?: string;
  coopCommission?: string;

  conditionTypes: ClauseType[];
  clauses: Clause[];
  pendingClause?: { type: ClauseType; label: string };

  financingAmount?: string;
  financingDays?: string;
  inspectionDays?: string;
  statusCertDays?: string;
  saleOfPropertyDays?: string;
  customClauseDescription?: string;

  pendingPdfs?: PendingPdf[];
  agentEmail?: string;
};

export function createSession(): TransactionSession {
  return {
    step: "idle",
    buyers: [],
    conditionTypes: [],
    clauses: [],
  };
}
