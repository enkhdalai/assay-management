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
  province?: string;
  district?: string;
};

export type CustomerDetail = CustomerRecord & {
  registrationNumber: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  organizationProfile: OrganizationProfileInput | null;
};

export type CreateCustomerInput = {
  type: CustomerType;
  displayName: string;
  registrationNumber?: string;
  email?: string;
  phone?: string;
  address?: string;
  province?: string;
  district?: string;
  organizationProfile?: OrganizationProfileInput;
};

export type OrganizationProfileInput = {
  depositName?: string;
  branchName?: string;
  organizationKind?: string;
  bankName?: string;
  bankAccount?: string;
  province?: string;
  district?: string;
  bag?: string;
  mineInitialNumber?: string;
  contactName?: string;
  contactPhone?: string;
  notes?: string;
};
