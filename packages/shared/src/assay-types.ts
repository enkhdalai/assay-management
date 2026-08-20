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
  bankName: string;
  allocatedGrams: number;
};

export type AssayApiRecord = {
  id: string;
  customerName: string;
  metal: MetalType;
  grossWeightGrams: number;
  purityPercent: number;
  fineWeightGrams: number;
  status: AssayStatus;
  allocations: BankAllocation[];
};
