export type OrganizationRecord = {
  id: string;
  name: string;
  code: string;
  type: string;
  status: string;
  updatedAt: string;
  bullionPrefix?: string | null;
};

export type OrganizationConnections = {
  organization: OrganizationRecord;
  staff: Array<{
    id: string;
    fullName: string;
    email: string;
    role: string;
    status: string;
    createdAt: string;
  }>;
  customers: Array<{
    id: string;
    displayName: string;
    type: "individual" | "legal_entity";
    intakeCount: number;
    lastReceivedAt: string | null;
  }>;
};

export const organizationTypeLabels: Record<string, string> = {
  private_assay_center: "Хувийн сорьцын төв",
  government_assay_center: "Төрийн сорьцын төв",
  system_operator: "Системийн байгууллага",
  commercial_bank: "Арилжааны банк",
  bank_of_mongolia: "Монголбанк",
};
