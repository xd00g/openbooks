/**
 * The single source of truth for grantable permissions.
 *
 * Pure — no imports (CLAUDE.md logic/IO split). Served to the web UI by
 * GET /admin/permissions so the role builder can never offer a permission
 * that no endpoint enforces, which was the original defect: the old
 * hardcoded frontend list offered invoice:create, bill:create,
 * payment:create, banking:reconcile and report:view, none of which were
 * enforced anywhere.
 *
 * '*' is deliberately NOT listed here. It is a wildcard understood by
 * authz.ts, not a resource permission, and the role builder offers it
 * separately as full access.
 */

export type PermissionRisk = 'normal' | 'high';

export interface PermissionDef {
  key: string;
  group: string;
  label: string;
  description: string;
  risk: PermissionRisk;
}

export const PERMISSION_CATALOG: PermissionDef[] = [
  // --- Core -----------------------------------------------------------
  { key: 'company:manage', group: 'Core', label: 'Company settings', description: 'Company profile, branding and theme.', risk: 'normal' },
  { key: 'user:manage', group: 'Core', label: 'Users and roles', description: 'Invite members, assign roles, edit roles.', risk: 'normal' },
  { key: 'system:manage', group: 'Core', label: 'System settings', description: 'SSO and SMTP configuration.', risk: 'normal' },
  { key: 'account:manage', group: 'Core', label: 'Chart of accounts', description: 'Create and edit ledger accounts.', risk: 'normal' },
  { key: 'settings:manage', group: 'Core', label: 'Reference data', description: 'Tax rates, products and services, payment terms.', risk: 'normal' },

  // --- Documents ------------------------------------------------------
  { key: 'sales:manage', group: 'Documents', label: 'Sales and invoices', description: 'Customers, invoices and received payments.', risk: 'normal' },
  { key: 'expenses:manage', group: 'Documents', label: 'Bills and vendors', description: 'Vendors and bills.', risk: 'normal' },
  { key: 'banking:manage', group: 'Documents', label: 'Banking', description: 'Bank accounts, feeds and transaction import.', risk: 'normal' },
  { key: 'banking:reconcile', group: 'Documents', label: 'Reconciliation', description: 'Run and complete bank reconciliations.', risk: 'normal' },
  { key: 'checks:manage', group: 'Documents', label: 'Check queue', description: 'View the check queue, history and alignment offsets.', risk: 'normal' },
  // Attachments are entity-agnostic (bills, invoices, company branding, ...),
  // so uploading is its own permission rather than being scoped to whichever
  // resource the attachment happens to point at. The tradeoff: a role that
  // needs to attach files must be granted this alongside whatever else it
  // holds — there is no per-entity "can attach to bills" vs "can attach to
  // invoices" distinction.
  { key: 'attachments:manage', group: 'Documents', label: 'Upload attachments', description: 'Upload and confirm file attachments for any entity type (bills, invoices, company branding, etc).', risk: 'normal' },

  // --- Sensitive reads ------------------------------------------------
  { key: 'reports:view', group: 'Sensitive reads', label: 'Financial reports', description: 'Trial balance, income statement, balance sheet, agings.', risk: 'normal' },
  { key: 'payroll:view', group: 'Sensitive reads', label: 'Payroll records', description: 'Employee records, which hold encrypted SSN and bank details.', risk: 'normal' },
  { key: 'attachments:view', group: 'Sensitive reads', label: 'Attachments', description: 'Download uploaded documents.', risk: 'normal' },
  { key: 'audit:view', group: 'Sensitive reads', label: 'Audit log', description: 'Read the record of who changed what.', risk: 'normal' },

  // --- High risk ------------------------------------------------------
  { key: 'period:close', group: 'High risk', label: 'Close periods', description: 'Close or reopen an accounting period.', risk: 'high' },
  { key: 'payroll:manage', group: 'High risk', label: 'Manage payroll', description: 'Employee master data and payroll setup.', risk: 'high' },
  { key: 'payroll:run', group: 'High risk', label: 'Run payroll', description: 'Finalize, void and delete payroll runs.', risk: 'high' },
  { key: 'checks:print', group: 'High risk', label: 'Print checks', description: 'Assign check numbers and render check PDFs.', risk: 'high' },
  { key: 'checks:void', group: 'High risk', label: 'Void checks', description: 'Void a check, which posts a reversing journal entry.', risk: 'high' },
];

export const PERMISSION_KEYS: string[] = PERMISSION_CATALOG.map((p) => p.key);

export function isKnownPermission(key: string): boolean {
  return PERMISSION_KEYS.includes(key);
}

/** The distinct resource names (the part before the colon) across the catalog. */
export const PERMISSION_RESOURCES: string[] = [
  ...new Set(PERMISSION_KEYS.map((k) => k.split(':')[0])),
];

/** Is `resource` one that actually has grantable permissions in the catalog? */
export function isKnownResource(resource: string): boolean {
  return PERMISSION_RESOURCES.includes(resource);
}

/**
 * Is `p` a permission a role is allowed to be granted? Accepts the '*'
 * superuser wildcard, a resource wildcard (`"sales:*"`) whose resource is
 * real, or an exact catalog key. Rejects everything else, including
 * wildcards over resources that don't exist (e.g. `"invoice:*"`).
 */
export function isValidPermissionGrant(p: string): boolean {
  if (p === '*') return true;
  if (p.endsWith(':*')) return isKnownResource(p.slice(0, -2));
  return isKnownPermission(p);
}

export interface SystemRoleDef {
  name: string;
  description: string;
  permissions: string[];
}

/**
 * The starter roles seeded for every new organization. Owner must stay first —
 * onboarding assigns it to the founding user.
 */
export const SYSTEM_ROLES: SystemRoleDef[] = [
  {
    name: 'Owner',
    description: 'Full access to everything.',
    permissions: ['*'],
  },
  {
    name: 'Accountant',
    description: 'Full books access, but cannot manage users or system settings.',
    permissions: PERMISSION_KEYS.filter(
      (k) => k !== 'user:manage' && k !== 'system:manage',
    ),
  },
  {
    name: 'Bookkeeper',
    description:
      'Day-to-day document entry and banking. Cannot close periods, print or void checks, or touch payroll.',
    permissions: [
      'sales:manage',
      'expenses:manage',
      'banking:manage',
      'banking:reconcile',
      'checks:manage',
      'settings:manage',
      'reports:view',
      'attachments:view',
      'attachments:manage',
    ],
  },
  {
    name: 'Read-only',
    description: 'Can view the books but change nothing.',
    permissions: ['reports:view', 'payroll:view', 'attachments:view', 'audit:view'],
  },
];
