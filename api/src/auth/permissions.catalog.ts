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
  { key: 'expenses:manage', group: 'Documents', label: 'Bills and vendors', description: 'Vendors, bills and attachments on bills.', risk: 'normal' },
  { key: 'banking:manage', group: 'Documents', label: 'Banking', description: 'Bank accounts, feeds and transaction import.', risk: 'normal' },
  { key: 'banking:reconcile', group: 'Documents', label: 'Reconciliation', description: 'Run and complete bank reconciliations.', risk: 'normal' },
  { key: 'checks:manage', group: 'Documents', label: 'Check queue', description: 'View the check queue, history and alignment offsets.', risk: 'normal' },

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
