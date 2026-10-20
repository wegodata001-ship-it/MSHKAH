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

/**
 * Dish-pricing permissions.
 *
 * The owner-level spec says "אין להסתמך רק על הסתרת כפתורים" — these
 * helpers are used both in the UI and server-side (via `requireAdminOnly`
 * at the API edge, plus a secondary role check for granular actions).
 *
 * We're conservative today: only Admins may edit a sale price or approve a
 * manual cost. Managers can view the panel but not mutate it. The flags
 * live here so a future role split (e.g. "Costing Owner") is a one-line
 * change.
 */
export function canEditPrice(role: string): boolean {
  return role === "Admin";
}

export function canApproveCost(role: string): boolean {
  return role === "Admin";
}
