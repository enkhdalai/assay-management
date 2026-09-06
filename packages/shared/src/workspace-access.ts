// Keep UI navigation and API authorization aligned without importing server code.
export function isCenterManager(role: string): boolean {
  return role === "system_admin" || role === "lab_manager" || role === "assay_admin";
}

export function isCenterStaff(role: string): boolean {
  return role === "chemist" || role === "intake_officer";
}

export function canManageStaff(
  actor: { id: string; role: string; organizationId: string },
  target: { id: string; role: string; organizationId: string },
): boolean {
  return actor.id !== target.id && isCenterStaff(target.role) && isCenterManager(actor.role)
    && (actor.role === "system_admin" || actor.organizationId === target.organizationId);
}

export function canInviteRole(
  actor: { role: string; organizationId: string },
  role: string,
  organizationId: string,
): boolean {
  if (actor.role === "system_admin") {
    return ["system_admin", "assay_admin", "lab_manager", "chemist", "intake_officer", "bom_officer", "commercial_bank_user", "auditor"].includes(role);
  }
  return isCenterManager(actor.role) && actor.organizationId === organizationId && isCenterStaff(role);
}

export const workspaceRoleLabels: Record<string, string> = {
  system_admin: "Супер админ",
  assay_admin: "Лабораторийн эрхлэгч",
  lab_manager: "Лабораторийн эрхлэгч",
  chemist: "Химич",
  intake_officer: "Хайлагч",
};
