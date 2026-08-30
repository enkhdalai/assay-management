export type BankOrganizationType = "commercial_bank" | "bank_of_mongolia";
export type BankOrganizationStatus = "active" | "suspended";

export type BankDirectoryRecord = {
  id: string;
  type: BankOrganizationType;
  status: BankOrganizationStatus;
  code: string;
  name: string;
  allocationCount: number;
  allocatedGrams: number;
  createdAt: string;
};

export type CreateBankInput = {
  type: BankOrganizationType;
  code: string;
  name: string;
};
