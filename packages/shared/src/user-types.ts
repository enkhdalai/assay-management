export type UserRole =
  | "system_admin"
  | "assay_admin"
  | "intake_officer"
  | "chemist"
  | "lab_manager"
  | "bom_officer"
  | "commercial_bank_user"
  | "auditor";

export type UserStatus = "invited" | "active" | "locked" | "disabled";

export type OrganizationType =
  | "private_assay_center"
  | "government_assay_center"
  | "bank_of_mongolia"
  | "commercial_bank"
  | "system_operator";

export type ManagedUser = {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  status: UserStatus;
  organizationId: string;
  organizationName: string;
  organizationType: OrganizationType;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};
