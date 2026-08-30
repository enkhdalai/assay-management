export type MetalType = "gold" | "silver";

export type AssayStatus =
  | "draft"
  | "received"
  | "in_analysis"
  | "manager_review"
  | "approved"
  | "bom_submitted"
  | "bom_confirmed"
  | "bank_assigned"
  | "settlement_pending"
  | "settled"
  | "closed"
  | "cancelled";

export type AssayResultStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "superseded"
  | "rejected";

export type AllocationStatus =
  | "draft"
  | "assigned"
  | "visible_to_bank"
  | "accepted_by_bank"
  | "settlement_pending"
  | "settled"
  | "cancelled";

export type BankAllocation = {
  bankId?: string;
  bankName: string;
  allocatedGrams: number;
};

export type AssayApiRecord = {
  id: string;
  customerName: string;
  metal: MetalType;
  grossWeightGrams: number;
  declaredWeightGrams: number;
  purityPercent: number | null;
  fineWeightGrams: number | null;
  status: AssayStatus;
  allocations: BankAllocation[];
  receivedAt: string | null;
};

export type CreateAssayInput = {
  customerId?: string;
  customerName: string;
  customerType: "individual" | "legal_entity";
  customerRegistrationNumber?: string;
  customerEmail?: string;
  customerPhone?: string;
  metal: MetalType;
  declaredWeightGrams: number;
  receivedWeightGrams: number;
  customerInstruction?: string;
  allocations: BankAllocation[];
};

export type AssayResultRevision = {
  id: string;
  revisionNo: number;
  status: AssayResultStatus;
  methodName: string;
  instrumentName: string | null;
  grossWeightGrams: number;
  purityPercent: number;
  fineWeightGrams: number;
  resultNotes: string | null;
  enteredByName: string;
  approvedByName: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  createdAt: string;
};

export type AssayResultWorkItem = AssayApiRecord & {
  intakeOfficerName: string | null;
  latestResult: AssayResultRevision | null;
};

export type SubmitAssayResultInput = {
  methodName: "XRF" | "Fire assay" | "ICP" | "Бусад";
  instrumentName?: string;
  grossWeightGrams: number;
  purityPercent: number;
  resultNotes?: string;
};
