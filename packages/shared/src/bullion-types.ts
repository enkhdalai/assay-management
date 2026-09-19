import type { AssayResultStatus, MetalType } from "./assay-types";

export type BullionCalculation = "yes" | "no" | "addition";

export type BullionWeightEntry = {
  receivedWeightGrams: number;
  calculation: BullionCalculation;
  outputWeightGrams: number;
  goldAssay?: number;
  silverAssay?: number;
};

export type BullionMeasurementEntry = {
  label: string;
  reading: number;
  goldAssay?: number;
  silverAssay?: number;
};

export type BullionIntakeItemInput = {
  analysisNo?: string;
  bullionNo?: string;
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
  actNumber?: string;
  actDate?: string;
  initialBullionNumber?: string;
  delta?: number;
  silverTiter?: number;
  status?: "draft" | "ready_for_sampling" | "sample_taken";
  items: BullionIntakeItemInput[];
};

export type CreateJewelryIntakeInput = {
  customerId: string;
  receivedAt: string;
  itemName: string;
  metal: "gold" | "silver";
  spoonType: "Халбагатай" | "Халбагагүй";
  qualityKind: "delta" | "titer";
  qualityValue: number;
  weightBand: string;
  pieceCount: number;
};

export type JewelryIntakeRecord = CreateJewelryIntakeInput & {
  id: string;
  assayCenterId: string;
  customerName?: string;
  receivedByName: string;
  createdAt: string;
};

export type BullionIntakeItemRecord = BullionIntakeItemInput & {
  id: string;
  sequenceNo: number;
  assignedChemistId?: string | null;
  assignedChemistName?: string | null;
  assignedAt?: string | null;
};

export type BullionIntakeBatchRecord = Omit<CreateBullionIntakeInput, "items"> & {
  id: string;
  publicId: string;
  customerName: string;
  receivedByName: string;
  wasEdited?: boolean;
  pieceCount: number;
  createdAt: string;
  items: BullionIntakeItemRecord[];
};

export type SubmitBullionExaminationInput = {
  calculationVersion?: string;
  expectedRevision?: number;
  bullionItemId: string;
  examinationNo: string;
  sampleWeightGrams: number;
  delta?: number;
  status: Extract<AssayResultStatus, "draft" | "submitted">;
  weightEntries: BullionWeightEntry[];
  measurementEntries: BullionMeasurementEntry[];
  goldResult?: number;
  silverResult?: number;
  silverMethod?: "rhodanometric" | "titrimetric";
  silverTiterMilligramsPerMilliliter?: number;
  silverBlankVolumeMilliliters?: number;
  reexaminationRequested?: boolean;
  notes?: string;
};

export type AnonymousSample = {
  batchId?: string;
  customerName?: string;
  registrationNo?: string;
  assignedChemistId?: string | null;
  assignedChemistName?: string | null;
  assignedAt?: string | null;
  completedAt?: string | null;
  approvedByName?: string | null;
  approvedAt?: string | null;
  returnedByName?: string | null;
  returnedAt?: string | null;
  returnNote?: string | null;
  substitutedByName?: string | null;
  substitutedAt?: string | null;
  batchProgress?: Array<{
    chemistId: string;
    chemistName: string;
    assignedCount: number;
    completedCount: number;
    completedAt: string | null;
  }>;
  batchReadyForFinalization?: boolean;
  certificateNo?: string | null;
  certificateSignatureStatus?: "unsigned" | "signing" | "cryptographically_verified" | "signed" | "failed" | "voided" | "superseded" | null;
  id: string;
  bullionNo: string;
  analysisNo: string;
  metal: MetalType;
  receivedAt: string;
  sampleWeightMilligrams: number;
  delta: number;
  silverTiter?: number | null;
  revisionNo: number;
  status: string;
  examination: SubmitBullionExaminationInput | null;
};
export type CertificateEntry = {
  analysisNo: string; bullionNo: string; bullionWeightGrams: number; origin: string | null;
  sampleWeightMilligrams: number; remainingMilligrams: number; returnedMilligrams: number;
  lossMilligrams: number; goldResult: number; silverResult: number; chemistName: string;
};
