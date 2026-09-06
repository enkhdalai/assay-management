export type OrganizationRecord = {
  id: string;
  name: string;
  code: string;
  type: string;
  status: string;
  updatedAt: string;
  bullionPrefix?: string | null;
};

export const organizationTypeLabels: Record<string, string> = {
  private_assay_center: "Хувийн сорьцын төв",
  government_assay_center: "Төрийн сорьцын төв",
  system_operator: "Системийн байгууллага",
  commercial_bank: "Арилжааны банк",
  bank_of_mongolia: "Монголбанк",
};
