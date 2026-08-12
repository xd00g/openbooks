/**
 * Pure authorization logic: permission matching and per-company access
 * resolution. No DB — takes the data the guards have already loaded.
 *
 * Permission grammar:
 *   "*"               -> superuser, allows everything
 *   "invoice:*"       -> any action on invoices
 *   "invoice:create"  -> that exact action
 */

export function hasPermission(granted: string[], required: string): boolean {
  if (granted.includes('*')) return true;
  if (granted.includes(required)) return true;
  const [resource] = required.split(':');
  return granted.includes(`${resource}:*`);
}

export function hasAllPermissions(
  granted: string[],
  required: string[],
): boolean {
  return required.every((r) => hasPermission(granted, r));
}

export interface MembershipView {
  companyId: string;
  organizationId: string;
  permissions: string[];
}

export interface CompanyAccess {
  companyId: string;
  organizationId: string;
  permissions: string[];
}

/**
 * Resolve the authenticated user's access to a requested company. Returns null
 * if the user has no membership there (caller turns that into 403).
 */
export function resolveCompanyAccess(
  memberships: MembershipView[],
  companyId: string,
): CompanyAccess | null {
  const m = memberships.find((x) => x.companyId === companyId);
  if (!m) return null;
  return {
    companyId: m.companyId,
    organizationId: m.organizationId,
    permissions: m.permissions,
  };
}

/** One member's effective permissions, for lockout checks. */
export interface MemberPermissionView {
  userId: string;
  permissions: string[];
}

/** Does this permission set allow managing users? Honours wildcards. */
export function grantsUserManage(permissions: string[]): boolean {
  return hasPermission(permissions, 'user:manage');
}

/**
 * Would applying `change` leave the company with nobody who can manage users?
 *
 * `newPermissions: null` means the member is being removed. A userId not
 * present in `members` is treated as an addition, which can never orphan.
 */
export function wouldOrphanCompany(
  members: MemberPermissionView[],
  change: { userId: string; newPermissions: string[] | null },
): boolean {
  const after = members
    .filter((m) => m.userId !== change.userId)
    .map((m) => m.permissions);

  if (change.newPermissions !== null) after.push(change.newPermissions);

  return !after.some((perms) => grantsUserManage(perms));
}
