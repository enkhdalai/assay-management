export type AppRole =
  | "system_admin"
  | "assay_admin"
  | "intake_officer"
  | "chemist"
  | "lab_manager"
  | "bom_officer"
  | "commercial_bank_user";

export const readOnlyBankRoles: AppRole[] = ["commercial_bank_user"];

export function canApproveAssay(role: AppRole): boolean {
  return role === "lab_manager" || role === "assay_admin";
}

export function canViewAllBankAllocations(role: AppRole): boolean {
  return role !== "commercial_bank_user";
}
