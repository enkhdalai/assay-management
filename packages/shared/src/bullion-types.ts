import type { AssayResultStatus, MetalType } from "./assay-types";

export type BullionCalculation = "yes" | "no" | "addition";

export type BullionWeightEntry = {
  receivedWeightGrams: number;
  calculation: BullionCalculation;
  outputWeightGrams: number;
};

export type BullionMeasurementEntry = {
  label: string;
  reading: number;
  goldAssay?: number;
  silverAssay?: number;
};

export type BullionIntakeItemInput = {
  analysisNo?: string;
  bullionNo: string;
  grossWeightBeforeGrams: number;
  grossWeightAfterGrams?: number;
  slagWeightGrams?: number;
  sampleWeightMilligrams?: number;
};

export type CreateBullionIntakeInput = {
  customerId: string;
  metal: MetalType;
  receivedAt?: string;
  branchName?: string;
  province?: string;
  district?: string;
  dispatchReference?: string;
  initialBullionNumber?: string;
  delta?: number;
  status?: "draft" | "sample_taken";
  items: BullionIntakeItemInput[];
};

export type BullionIntakeItemRecord = BullionIntakeItemInput & {
  id: string;
  sequenceNo: number;
};

export type BullionIntakeBatchRecord = Omit<CreateBullionIntakeInput, "items"> & {
  id: string;
  publicId: string;
  customerName: string;
  receivedByName: string;
  pieceCount: number;
  createdAt: string;
  items: BullionIntakeItemRecord[];
};

export type SubmitBullionExaminationInput = {
  bullionItemId: string;
  examinationNo: string;
  sampleWeightGrams: number;
  delta?: number;
  status: Extract<AssayResultStatus, "draft" | "submitted">;
  weightEntries: BullionWeightEntry[];
  measurementEntries: BullionMeasurementEntry[];
  goldResult?: number;
  silverResult?: number;
  reexaminationRequested?: boolean;
  notes?: string;
};
