export type CustomerType = "individual" | "legal_entity";

export type CustomerRecord = {
  id: string;
  type: CustomerType;
  displayName: string;
  registrationNumberMasked: string | null;
  emailMasked: string | null;
  phoneMasked: string | null;
  totalAssays: number;
  totalGrossWeightGrams: number;
  lastAssayAt: string | null;
  createdAt: string;
};

export type CreateCustomerInput = {
  type: CustomerType;
  displayName: string;
  registrationNumber?: string;
  email?: string;
  phone?: string;
  address?: string;
};
