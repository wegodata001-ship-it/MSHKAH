export const ROLES = ["Admin", "Manager", "Employee"] as const;
export type UserRole = (typeof ROLES)[number];

export function isAdminRole(role: string): boolean {
  return role === "Admin";
}

export function canManageUsers(role: string): boolean {
  return role === "Admin";
}

export function canWriteCatalog(role: string): boolean {
  return role === "Admin" || role === "Manager";
}

export function canViewCosting(role: string): boolean {
  return role === "Admin";
}
