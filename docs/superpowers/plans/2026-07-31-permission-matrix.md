# Permission Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing user → company → role → permissions model actually enforce across the whole API, backed by one catalog that cannot drift from what the code enforces.

**Architecture:** A pure `permissions.catalog.ts` becomes the single source of truth, served to the web UI by a new endpoint and guarded by a test that greps every `@RequirePermissions` decorator and asserts the catalog and the enforced set match in both directions. The enforcement sweep then adds decorators to ~78 currently-open endpoints, grouped by controller so each task is independently reviewable. Seeded system roles and two lockout guards make the result usable and un-brickable.

**Tech Stack:** NestJS 10, Prisma 5, PostgreSQL 16, Jest 29, React 18 + Vite + Tailwind.

## Global Constraints

- **No schema change.** `Membership(userId, companyId, roleId)` with `@@unique([userId, companyId])` and `Role.permissions String[]` already exist and are correct. Do not alter them.
- **Roles stay org-scoped** (`Role.organizationId`, nullable for system templates). Per-company assignment comes from `Membership`.
- **`authz.ts` grammar is unchanged**: `*` allows everything, `resource:*` allows any action on a resource, `resource:action` is exact.
- **`'*'` is NOT a catalog entry.** It is a wildcard understood by `authz.ts`, offered separately in the role builder as full access.
- **Pure logic separated from I/O**: `permissions.catalog.ts` and `authz.ts` contain no imports from `@prisma/client` or NestJS.
- **`auth`, `onboarding`, and `health` controllers stay ungated** — they must be reachable pre-authentication.
- **Convention:** every POST/PATCH/PUT/DELETE is gated. GETs stay open to company members EXCEPT the sensitive-reads group (`reports:view`, `payroll:view`, `attachments:view`, `audit:view`).
- **NEVER use `sudo`.** A previous subagent left 33,613 root-owned files that had to be repaired.
- Test commands: `cd api && npm test`, `npm run typecheck`. Integration:
  `cd api && LD_LIBRARY_PATH="$PWD/node_modules/@embedded-postgres/linux-x64/native/lib" node test/integration/db-guarantees.int.mjs`
- Spec: `docs/superpowers/specs/2026-07-31-permission-matrix-design.md`

---

## File Structure

**Create:**
- `api/src/auth/permissions.catalog.ts` — the 19 permission definitions plus the four system-role definitions, pure, zero imports
- `api/src/auth/__tests__/permissions.catalog.spec.ts` — catalog integrity + the two-way drift test
- `api/src/auth/__tests__/authz.lockout.spec.ts` — lockout predicate tests
- `web/src/components/RoleMatrix.tsx` — the matrix UI, split out of `Admin.tsx`

**Modify:**
- `api/src/auth/authz.ts` — add the two pure lockout predicates
- `api/src/admin/admin.controller.ts` — add `GET permissions`; change audit gate to `audit:view`
- `api/src/admin/admin.service.ts` — validate permissions on role create; enforce lockout guards
- `api/src/auth/onboarding.service.ts` — seed the system roles (it already holds the `AdminPrismaService` connection and creates the Owner role today)
- Controllers gaining decorators: `sales`, `expenses`, `reconciliation`, `reporting`, `period-close`, `tax`, `items`, `payment-terms`, `attachments`, `accounts`, `company`, `bank-accounts`, `checks`, `payroll`, `import`
- `web/src/pages/Admin.tsx` — delete the hardcoded `PERMISSIONS` array, render `RoleMatrix`

---

## Task 1: The catalog and the drift test

**Files:**
- Create: `api/src/auth/permissions.catalog.ts`
- Test: `api/src/auth/__tests__/permissions.catalog.spec.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `type PermissionRisk`, `interface PermissionDef`, `PERMISSION_CATALOG: PermissionDef[]`, `PERMISSION_KEYS: string[]`, `isKnownPermission(key: string): boolean`

**Important:** the drift test's "no phantom offers" direction will FAIL until the sweep in Tasks 4–7 is complete, because most catalog entries have no decorator yet. Task 1 therefore writes that half of the test as `it.todo`, and Task 8 activates it once the sweep lands. Do not weaken the assertion instead — the whole point is that it eventually holds.

- [ ] **Step 1: Write the catalog**

Create `api/src/auth/permissions.catalog.ts`:

```typescript
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
```

- [ ] **Step 2: Write the integrity and drift tests**

Create `api/src/auth/__tests__/permissions.catalog.spec.ts`:

```typescript
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  PERMISSION_CATALOG,
  PERMISSION_KEYS,
  isKnownPermission,
} from '../permissions.catalog';

const SRC = resolve(__dirname, '../..');

/** Every *.controller.ts under api/src, recursively. */
function controllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...controllerFiles(full));
    } else if (entry.endsWith('.controller.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Every string passed to @RequirePermissions(...) across all controllers. */
function enforcedPermissions(): Set<string> {
  const found = new Set<string>();
  for (const file of controllerFiles(SRC)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/@RequirePermissions\(([^)]*)\)/g)) {
      for (const s of m[1].matchAll(/'([^']+)'/g)) found.add(s[1]);
    }
  }
  return found;
}

describe('permission catalog integrity', () => {
  it('has unique keys', () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
  });

  it('gives every entry a label, description and group', () => {
    for (const p of PERMISSION_CATALOG) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
      expect(p.group.length).toBeGreaterThan(0);
    }
  });

  it('uses only resource:action keys', () => {
    for (const key of PERMISSION_KEYS) {
      expect(key).toMatch(/^[a-z]+:[a-z]+$/);
    }
  });

  it('does not list the * wildcard as a grantable permission', () => {
    expect(PERMISSION_KEYS).not.toContain('*');
  });

  it('recognises known keys and rejects unknown ones', () => {
    expect(isKnownPermission('sales:manage')).toBe(true);
    expect(isKnownPermission('invoice:create')).toBe(false);
  });

  it('marks the irreversible actions as high risk', () => {
    const high = PERMISSION_CATALOG.filter((p) => p.risk === 'high').map((p) => p.key);
    expect(high).toEqual(
      expect.arrayContaining([
        'period:close',
        'payroll:run',
        'checks:print',
        'checks:void',
      ]),
    );
  });
});

describe('catalog matches enforcement', () => {
  it('has no phantom enforcement: every decorator permission is in the catalog', () => {
    const unknown = [...enforcedPermissions()].filter((p) => !isKnownPermission(p));
    expect(unknown).toEqual([]);
  });

  // Activated in Task 8, once the enforcement sweep is complete. Until then
  // most catalog entries legitimately have no decorator yet.
  it.todo('has no phantom offers: every catalog permission is enforced somewhere');
});
```

- [ ] **Step 3: Run the tests**

Run: `cd api && npx jest src/auth --verbose`
Expected: PASS. The "no phantom enforcement" test currently passes because the 7 permissions in use (`account:manage`, `banking:manage`, `company:manage`, `payroll:manage`, `payroll:run`, `system:manage`, `user:manage`) are all in the catalog.

- [ ] **Step 4: Commit**

```bash
git add api/src/auth/permissions.catalog.ts api/src/auth/__tests__/permissions.catalog.spec.ts
git commit -m "feat(auth): permission catalog as the single source of truth"
```

---

## Task 2: Lockout predicates

**Files:**
- Modify: `api/src/auth/authz.ts`
- Test: `api/src/auth/__tests__/authz.lockout.spec.ts`

**Interfaces:**
- Consumes: `hasPermission(granted: string[], required: string): boolean` (already in `authz.ts`)
- Produces:
  - `interface MemberPermissionView { userId: string; permissions: string[] }`
  - `function grantsUserManage(permissions: string[]): boolean`
  - `function wouldOrphanCompany(members: MemberPermissionView[], change: { userId: string; newPermissions: string[] | null }): boolean`

`newPermissions: null` means the member is being removed entirely.

- [ ] **Step 1: Write the failing tests**

Create `api/src/auth/__tests__/authz.lockout.spec.ts`:

```typescript
import {
  grantsUserManage,
  wouldOrphanCompany,
  type MemberPermissionView,
} from '../authz';

describe('grantsUserManage', () => {
  it('accepts the exact permission', () => {
    expect(grantsUserManage(['user:manage'])).toBe(true);
  });

  it('accepts the superuser wildcard', () => {
    expect(grantsUserManage(['*'])).toBe(true);
  });

  it('accepts the resource wildcard', () => {
    expect(grantsUserManage(['user:*'])).toBe(true);
  });

  it('rejects unrelated permissions', () => {
    expect(grantsUserManage(['sales:manage', 'reports:view'])).toBe(false);
  });

  it('rejects an empty permission set', () => {
    expect(grantsUserManage([])).toBe(false);
  });
});

describe('wouldOrphanCompany', () => {
  const owner: MemberPermissionView = { userId: 'u1', permissions: ['*'] };
  const clerk: MemberPermissionView = { userId: 'u2', permissions: ['sales:manage'] };
  const admin2: MemberPermissionView = { userId: 'u3', permissions: ['user:manage'] };

  it('blocks demoting the only admin', () => {
    expect(
      wouldOrphanCompany([owner, clerk], { userId: 'u1', newPermissions: ['sales:manage'] }),
    ).toBe(true);
  });

  it('blocks removing the only admin', () => {
    expect(
      wouldOrphanCompany([owner, clerk], { userId: 'u1', newPermissions: null }),
    ).toBe(true);
  });

  it('allows demoting one admin when another remains', () => {
    expect(
      wouldOrphanCompany([owner, admin2], { userId: 'u1', newPermissions: ['sales:manage'] }),
    ).toBe(false);
  });

  it('allows removing a non-admin', () => {
    expect(
      wouldOrphanCompany([owner, clerk], { userId: 'u2', newPermissions: null }),
    ).toBe(false);
  });

  it('allows promoting a member to admin', () => {
    expect(
      wouldOrphanCompany([owner, clerk], { userId: 'u2', newPermissions: ['user:manage'] }),
    ).toBe(false);
  });

  it('treats a change to an unknown member as adding them', () => {
    expect(
      wouldOrphanCompany([owner], { userId: 'new', newPermissions: ['sales:manage'] }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd api && npx jest src/auth/__tests__/authz.lockout.spec.ts --verbose`
Expected: FAIL — `grantsUserManage is not a function`

- [ ] **Step 3: Implement**

Append to `api/src/auth/authz.ts`:

```typescript
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd api && npx jest src/auth --verbose`
Expected: PASS — all lockout and catalog tests.

- [ ] **Step 5: Commit**

```bash
git add api/src/auth/authz.ts api/src/auth/__tests__/authz.lockout.spec.ts
git commit -m "feat(auth): lockout predicates for role changes"
```

---

## Task 3: Serve the catalog, validate roles, enforce lockout

**Files:**
- Modify: `api/src/admin/admin.controller.ts`
- Modify: `api/src/admin/admin.service.ts`

**Interfaces:**
- Consumes: `PERMISSION_CATALOG`, `isKnownPermission` (Task 1); `wouldOrphanCompany`, `grantsUserManage`, `MemberPermissionView` (Task 2)
- Produces: `GET /admin/permissions` returning `PermissionDef[]`

- [ ] **Step 1: Add the endpoint**

In `api/src/admin/admin.controller.ts`, add the import:

```typescript
import { PERMISSION_CATALOG } from '../auth/permissions.catalog';
```

and add this handler alongside the other `@Get` handlers:

```typescript
  @Get('permissions')
  @RequirePermissions('user:manage')
  permissions() {
    return PERMISSION_CATALOG;
  }
```

- [ ] **Step 2: Retarget the audit gate**

In the same file, the `@Get('audit')` handler (around line 127) currently carries `@RequirePermissions('user:manage')`. Change that decorator to:

```typescript
  @RequirePermissions('audit:view')
```

- [ ] **Step 3: Validate permissions when creating a role**

In `api/src/admin/admin.service.ts`, add the imports:

```typescript
import { isKnownPermission } from '../auth/permissions.catalog';
import {
  wouldOrphanCompany,
  grantsUserManage,
  type MemberPermissionView,
} from '../auth/authz';
```

In `createRole`, before writing, reject unknown keys. `'*'` is allowed even though it is not in the catalog, because it is a wildcard:

```typescript
    const unknown = data.permissions.filter(
      (p) => p !== '*' && !p.endsWith(':*') && !isKnownPermission(p),
    );
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unknown permission(s): ${unknown.join(', ')}`,
      );
    }
```

Import `BadRequestException` from `@nestjs/common` if it is not already imported.

- [ ] **Step 4: Enforce the lockout guards**

Still in `api/src/admin/admin.service.ts`, add this private helper:

```typescript
  /** Load every member's effective permissions for lockout checks. */
  private async memberPermissions(
    tx: { membership: { findMany: Function } },
    companyId: string,
  ): Promise<MemberPermissionView[]> {
    const rows = await tx.membership.findMany({
      where: { companyId },
      include: { role: { select: { permissions: true } } },
    });
    return rows.map((m: any) => ({
      userId: m.userId,
      permissions: m.role.permissions as string[],
    }));
  }
```

In `updateMemberRole(companyId, userId, roleId)`, before writing, load the target role's permissions and reject an orphaning change:

```typescript
      const target = await tx.role.findFirst({
        where: { id: roleId },
        select: { permissions: true },
      });
      if (!target) throw new NotFoundException('Role not found.');

      const members = await this.memberPermissions(tx, companyId);
      if (wouldOrphanCompany(members, { userId, newPermissions: target.permissions })) {
        throw new ConflictException(
          'This change would leave the company with no one who can manage users.',
        );
      }
```

In `removeMember(companyId, userId)`, apply the same check with `newPermissions: null`:

```typescript
      const members = await this.memberPermissions(tx, companyId);
      if (wouldOrphanCompany(members, { userId, newPermissions: null })) {
        throw new ConflictException(
          'This would remove the last member who can manage users.',
        );
      }
```

Import `ConflictException` and `NotFoundException` from `@nestjs/common` if not already imported.

- [ ] **Step 5: Verify**

Run: `cd api && npm run typecheck && npm test`
Expected: typecheck clean; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add api/src/admin/admin.controller.ts api/src/admin/admin.service.ts
git commit -m "feat(admin): serve the catalog, validate roles, guard against lockout"
```

---

## Task 4: Gate sales and expenses

**Files:**
- Modify: `api/src/sales/sales.controller.ts`
- Modify: `api/src/expenses/expenses.controller.ts`

**Interfaces:**
- Consumes: the catalog keys from Task 1
- Produces: nothing consumed by later tasks

Import in each file, if not already present:

```typescript
import { RequirePermissions } from '../auth/decorators';
```

Place each `@RequirePermissions(...)` immediately below its `@Post`/`@Patch`/`@Delete` decorator and above the handler, matching how `checks.controller.ts` does it.

- [ ] **Step 1: Gate sales mutations**

In `api/src/sales/sales.controller.ts`, add `@RequirePermissions('sales:manage')` to each of these handlers:

- `@Post('customers')` (line ~28)
- `@Patch('customers/:id')` (~36)
- `@Post('invoices')` (~50)
- `@Patch('invoices/:id')` (~67)
- `@Post('invoices/:id/revert')` (~85)
- `@Post('invoices/:id/finalize')` (~90)
- `@Post('invoices/:id/void')` (~95)
- `@Post('invoices/:id/send')` (~109)
- `@Delete('invoices/:id')` (~118)
- `@Post('payments')` (~133)

Leave ungated: `@Get('customers')`, `@Get('invoices')`, `@Get('invoices/:id')`, `@Get('invoices/:id/pdf')` — reads open to company members per the convention.

- [ ] **Step 2: Gate expenses mutations**

In `api/src/expenses/expenses.controller.ts`, add `@RequirePermissions('expenses:manage')` to:

- `@Post('vendors')` (~28)
- `@Patch('vendors/:id')` (~36)
- `@Post('bills')` (~55)
- `@Patch('bills/:id')` (~72)
- `@Post('bills/:id/revert')` (~90)
- `@Post('bills/:id/finalize')` (~95)
- `@Post('bills/:id/void')` (~100)
- `@Delete('bills/:id')` (~105)

**Leave `@Post('payments')` on its existing `@RequirePermissions('banking:manage')`** — it debits a bank account, so it is a banking action. Do not change it.

Leave ungated: `@Get('vendors')`, `@Get('vendors/:id/statement')`, `@Get('bills')`, `@Get('bills/:id')`.

- [ ] **Step 3: Verify**

Run: `cd api && npm run typecheck && npx jest src/auth --verbose`
Expected: typecheck clean; the "no phantom enforcement" test still passes because `sales:manage` and `expenses:manage` are both in the catalog.

- [ ] **Step 4: Commit**

```bash
git add api/src/sales/sales.controller.ts api/src/expenses/expenses.controller.ts
git commit -m "feat(auth): gate sales and expenses mutations"
```

---

## Task 5: Gate banking, checks and period close

**Files:**
- Modify: `api/src/banking/reconciliation.controller.ts`
- Modify: `api/src/banking/bank-accounts.controller.ts`
- Modify: `api/src/checks/checks.controller.ts`
- Modify: `api/src/period/period-close.controller.ts`

**Interfaces:**
- Consumes: catalog keys from Task 1
- Produces: nothing consumed by later tasks

Import `RequirePermissions` from `'../auth/decorators'` in each file if not present.

- [ ] **Step 1: Gate reconciliation**

In `api/src/banking/reconciliation.controller.ts`, add `@RequirePermissions('banking:reconcile')` to every handler — reconciliation as a whole is the privileged activity:

- `@Post()` (~25), `@Get()` (~39), `@Get('suggestions')` (~47), `@Post(':id/cleared')` (~60), `@Get(':id/summary')` (~74), `@Post(':id/complete')` (~82), `@Get(':id')` (~90)

- [ ] **Step 2: Gate bank account reads**

In `api/src/banking/bank-accounts.controller.ts`, add `@RequirePermissions('banking:manage')` to the two currently-ungated handlers:

- `@Get()` (~30)
- `@Get(':id/transactions')` (~71)

The three `@Post` handlers already carry `banking:manage` — leave them.

- [ ] **Step 3: Retarget the checks controller**

In `api/src/checks/checks.controller.ts`, all six gated handlers currently use `banking:manage`. Change them:

- `@Get('queue')` (~24) — add `@RequirePermissions('checks:manage')` (currently ungated)
- `@Get('history')` (~33) — add `@RequirePermissions('checks:manage')` (currently ungated)
- `@Post('print')` (~42) — change to `checks:print`
- `@Get('print/:batchId/pdf')` (~57) — change to `checks:print`
- `@Post('print/:batchId/confirm')` (~70) — change to `checks:print`
- `@Post(':id/void')` (~80) — change to `checks:void`
- `@Get('alignment-test')` (~91) — change to `checks:manage`
- `@Post('offsets')` (~105) — change to `checks:manage`

This is a deliberate behaviour change: a role holding only `banking:manage` loses check access, because printing a negotiable instrument is a distinct privilege from managing a bank account (spec §4.1).

- [ ] **Step 4: Gate period close**

In `api/src/period/period-close.controller.ts`, add `@RequirePermissions('period:close')` to both handlers:

- `@Post()` (~22)
- `@Post('reopen')` (~31)

- [ ] **Step 5: Verify**

Run: `cd api && npm run typecheck && npx jest src/auth --verbose`
Expected: typecheck clean; phantom-enforcement test passes.

- [ ] **Step 6: Commit**

```bash
git add api/src/banking/reconciliation.controller.ts api/src/banking/bank-accounts.controller.ts api/src/checks/checks.controller.ts api/src/period/period-close.controller.ts
git commit -m "feat(auth): gate reconciliation, bank accounts, checks and period close"
```

---

## Task 6: Gate reporting, payroll reads and attachments

**Files:**
- Modify: `api/src/reporting/reporting.controller.ts`
- Modify: `api/src/payroll/payroll.controller.ts`
- Modify: `api/src/attachments/attachments.controller.ts`

**Interfaces:**
- Consumes: catalog keys from Task 1
- Produces: nothing consumed by later tasks

Import `RequirePermissions` from `'../auth/decorators'` in each file if not present.

- [ ] **Step 1: Gate all reporting**

In `api/src/reporting/reporting.controller.ts`, add `@RequirePermissions('reports:view')` to all five handlers:

- `@Get('trial-balance')` (~32), `@Get('income-statement')` (~45), `@Get('balance-sheet')` (~62), `@Get('ar-aging')` (~75), `@Get('ap-aging')` (~86)

- [ ] **Step 2: Gate payroll reads**

In `api/src/payroll/payroll.controller.ts`, add `@RequirePermissions('payroll:view')` to the three currently-ungated read handlers:

- `@Get('employees')` (~46)
- `@Get('runs')` (~87)
- `@Get('runs/:id')` (~92)

Leave every existing `payroll:manage` and `payroll:run` decorator exactly as it is.

- [ ] **Step 3: Gate attachments**

In `api/src/attachments/attachments.controller.ts`:

- `@Get()` (~49) — add `@RequirePermissions('attachments:view')`
- `@Get(':id/download-url')` (~58) — add `@RequirePermissions('attachments:view')`
- `@Post('upload-url')` (~25) — add `@RequirePermissions('expenses:manage')`
- `@Post(':id/confirm')` (~40) — add `@RequirePermissions('expenses:manage')`

- [ ] **Step 4: Verify**

Run: `cd api && npm run typecheck && npx jest src/auth --verbose`
Expected: typecheck clean; phantom-enforcement test passes.

- [ ] **Step 5: Commit**

```bash
git add api/src/reporting/reporting.controller.ts api/src/payroll/payroll.controller.ts api/src/attachments/attachments.controller.ts
git commit -m "feat(auth): gate reporting, payroll reads and attachments"
```

---

## Task 7: Gate reference data, accounts, company and import

**Files:**
- Modify: `api/src/tax/tax.controller.ts`
- Modify: `api/src/items/items.controller.ts`
- Modify: `api/src/payment-terms/payment-terms.controller.ts`
- Modify: `api/src/accounts/accounts.controller.ts`
- Modify: `api/src/company/company.controller.ts`
- Modify: `api/src/import/import.controller.ts`

**Interfaces:**
- Consumes: catalog keys from Task 1
- Produces: nothing consumed by later tasks

Import `RequirePermissions` from `'../auth/decorators'` in each file if not present.

- [ ] **Step 1: Gate reference-data mutations**

Add `@RequirePermissions('settings:manage')` to:

- `api/src/tax/tax.controller.ts`: `@Post('rates')` (~35), `@Patch('rates/:id')` (~40)
- `api/src/items/items.controller.ts`: `@Post()` (~30), `@Patch(':id')` (~35)
- `api/src/payment-terms/payment-terms.controller.ts`: `@Post()` (~30), `@Patch(':id')` (~35)

Leave the `@Get` handlers in all three ungated — invoice and bill forms need to read tax rates, items and terms, so gating them would break document entry for anyone without `settings:manage`.

- [ ] **Step 2: Gate account transactions**

In `api/src/accounts/accounts.controller.ts`, add `@RequirePermissions('account:manage')` to the two ungated mutations:

- `@Post(':id/transactions')` (~37)
- `@Post(':id/import')` (~46)

Leave `@Get()` (~27) and `@Get(':id/register')` (~32) ungated. The three existing `account:manage` decorators stay as they are.

- [ ] **Step 3: Gate company reads**

In `api/src/company/company.controller.ts`, leave `@Get()` (~17) and `@Get('logo-url')` (~22) ungated — the app shell loads branding for every user on every page. `@Patch()` already carries `company:manage`; leave it.

No change to this file. Note it explicitly in your report so the reviewer knows it was considered, not missed.

- [ ] **Step 4: Retarget import**

In `api/src/import/import.controller.ts`, both handlers carry `@RequirePermissions('account:manage')`. Change both to:

```typescript
  @RequirePermissions('banking:manage')
```

- `@Post('preview')` (~24)
- `@Post('commit')` (~32)

IIF import brings in bank and ledger data, so it belongs with banking rather than chart-of-accounts editing.

- [ ] **Step 5: Verify**

Run: `cd api && npm run typecheck && npx jest src/auth --verbose`
Expected: typecheck clean; phantom-enforcement test passes.

- [ ] **Step 6: Commit**

```bash
git add api/src/tax/tax.controller.ts api/src/items/items.controller.ts api/src/payment-terms/payment-terms.controller.ts api/src/accounts/accounts.controller.ts api/src/import/import.controller.ts
git commit -m "feat(auth): gate reference data, account transactions and import"
```

---

## Task 8: Activate the drift test

**Files:**
- Modify: `api/src/auth/__tests__/permissions.catalog.spec.ts`

**Interfaces:**
- Consumes: the completed sweep from Tasks 4–7
- Produces: a permanently enforced two-way invariant

This is the task that makes the catalog trustworthy. Every one of the 19 permissions must now be enforced by at least one decorator.

- [ ] **Step 1: Replace the todo with a real test**

In `api/src/auth/__tests__/permissions.catalog.spec.ts`, replace:

```typescript
  it.todo('has no phantom offers: every catalog permission is enforced somewhere');
```

with:

```typescript
  it('has no phantom offers: every catalog permission is enforced somewhere', () => {
    const enforced = enforcedPermissions();
    const unenforced = PERMISSION_KEYS.filter((k) => !enforced.has(k));
    expect(unenforced).toEqual([]);
  });
```

- [ ] **Step 2: Run it**

Run: `cd api && npx jest src/auth --verbose`
Expected: PASS.

If it fails, the failure message lists exactly which catalog permissions have no decorator. **Do not delete the failing permission from the catalog to make the test pass** unless you have confirmed no endpoint should enforce it. The correct fix is almost always to add the missing decorator in the controller that owns that resource. If you genuinely cannot find an endpoint for a permission, stop and report it — that is a spec gap, not a test problem.

- [ ] **Step 3: Full suite**

Run: `cd api && npm run typecheck && npm test`
Expected: typecheck clean; all tests pass.

- [ ] **Step 4: Commit**

```bash
git add api/src/auth/__tests__/permissions.catalog.spec.ts
git commit -m "test(auth): enforce that catalog and decorators cannot drift"
```

---

## Task 9: Seed system roles

**Files:**
- Modify: `api/src/auth/permissions.catalog.ts`
- Modify: `api/src/auth/onboarding.service.ts`
- Test: `api/src/auth/__tests__/permissions.catalog.spec.ts`

**Interfaces:**
- Consumes: `PERMISSION_CATALOG`, `PERMISSION_KEYS` (Task 1)
- Produces: `SYSTEM_ROLES: SystemRoleDef[]` exported from `permissions.catalog.ts`

**Where this belongs, verified:** `api/src/auth/onboarding.service.ts` already injects `AdminPrismaService` as `this.admin` and creates the Owner role inside `this.admin.$transaction(...)` — at line ~42 for a fresh org, and again at line ~149 where it reuses or creates an Owner role for an SSO user. `Role` is org-scoped and is **not** in the RLS `tenant_tables` array, so it is reachable on that admin connection. Put the seeding there; `AdminService` needs no change.

- [ ] **Step 1: Add the role definitions to the catalog**

Append to `api/src/auth/permissions.catalog.ts` (still zero imports):

```typescript
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
    ],
  },
  {
    name: 'Read-only',
    description: 'Can view the books but change nothing.',
    permissions: ['reports:view', 'payroll:view', 'attachments:view', 'audit:view'],
  },
];
```

- [ ] **Step 2: Test the definitions**

Append to `api/src/auth/__tests__/permissions.catalog.spec.ts`:

```typescript
import { SYSTEM_ROLES } from '../permissions.catalog';

describe('system roles', () => {
  it('grants Owner full access', () => {
    expect(SYSTEM_ROLES[0].name).toBe('Owner');
    expect(SYSTEM_ROLES[0].permissions).toEqual(['*']);
  });

  it('references only real permissions (or the wildcard)', () => {
    for (const role of SYSTEM_ROLES) {
      for (const p of role.permissions) {
        if (p === '*') continue;
        expect(isKnownPermission(p)).toBe(true);
      }
    }
  });

  it('keeps Accountant out of user and system administration', () => {
    const acct = SYSTEM_ROLES.find((r) => r.name === 'Accountant')!;
    expect(acct.permissions).not.toContain('user:manage');
    expect(acct.permissions).not.toContain('system:manage');
  });

  it('keeps Bookkeeper away from the irreversible actions', () => {
    const bk = SYSTEM_ROLES.find((r) => r.name === 'Bookkeeper')!;
    for (const denied of ['period:close', 'checks:print', 'checks:void', 'payroll:run', 'payroll:manage']) {
      expect(bk.permissions).not.toContain(denied);
    }
  });

  it('gives Read-only nothing but view permissions', () => {
    const ro = SYSTEM_ROLES.find((r) => r.name === 'Read-only')!;
    for (const p of ro.permissions) expect(p.endsWith(':view')).toBe(true);
  });

  it('uses unique role names', () => {
    const names = SYSTEM_ROLES.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `cd api && npx jest src/auth --verbose`
Expected: PASS.

- [ ] **Step 4: Seed during onboarding**

In `api/src/auth/onboarding.service.ts`, add the import:

```typescript
import { SYSTEM_ROLES } from './permissions.catalog';
```

Add a private helper that creates any missing system role and returns the Owner row. It takes the transaction client the caller is already inside:

```typescript
  /**
   * Ensure the four starter roles exist for an organization and return Owner.
   * Idempotent: matched on (organizationId, name), which is already a unique
   * constraint, so an operator who customised a role keeps their version.
   */
  private async ensureSystemRoles(tx: any, organizationId: string) {
    let owner: any = null;
    for (const def of SYSTEM_ROLES) {
      const existing = await tx.role.findFirst({
        where: { organizationId, name: def.name },
      });
      const row =
        existing ??
        (await tx.role.create({
          data: {
            organizationId,
            name: def.name,
            description: def.description,
            permissions: def.permissions,
            isSystem: true,
          },
        }));
      if (def.name === 'Owner') owner = row;
    }
    return owner;
  }
```

Then replace **both** Owner-role sites with a call to it:

- Around line 42, `const ownerRole = await tx.role.create({ ... })` becomes
  `const ownerRole = await this.ensureSystemRoles(tx, <organizationId in scope>);`
- Around lines 149–153, the `findFirst ?? create` expression becomes
  `const ownerRole = await this.ensureSystemRoles(tx, <organizationId in scope>);`

Both sites already use `ownerRole.id` for the membership, so nothing downstream changes. Read the surrounding code to get the correct organization-id variable at each site — do not guess.

- [ ] **Step 5: Verify idempotency against the live database**

The live org already has an `Owner` role, so seeding must add exactly the three missing roles and leave Owner untouched.

```bash
cd /home/tcc-azure/openbooks && docker compose exec -T postgres psql -U openbooks -d openbooks -tAc "SELECT name, array_to_string(permissions,',') FROM role ORDER BY name;"
```

Record the output before and after exercising an onboarding call. Owner's `permissions` must still be exactly `*`, and no role may appear twice. Report both listings.

- [ ] **Step 6: Full suite**

Run: `cd api && npm run typecheck && npm test`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add api/src/auth/permissions.catalog.ts api/src/auth/__tests__/permissions.catalog.spec.ts api/src/auth/onboarding.service.ts
git commit -m "feat(auth): seed Owner, Accountant, Bookkeeper and Read-only roles"
```

---

## Task 10: The role matrix UI

**Files:**
- Create: `web/src/components/RoleMatrix.tsx`
- Modify: `web/src/pages/Admin.tsx`

**Interfaces:**
- Consumes: `GET /admin/permissions` → `PermissionDef[]` (Task 3); `GET /admin/roles`; `POST /admin/roles`
- Produces: a `RoleMatrix` component

- [ ] **Step 1: Build the matrix component**

Create `web/src/components/RoleMatrix.tsx`. Use ONLY existing primitives from `web/src/components/ui.tsx` — `Card`, `Table`, `Button`, `Banner`, `Empty`. No new colours or design tokens; radius stays at the 2px cap.

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Card, Table, Button, Banner, Empty } from './ui';

interface PermissionDef {
  key: string;
  group: string;
  label: string;
  description: string;
  risk: 'normal' | 'high';
}

interface Role {
  id: string;
  name: string;
  description?: string | null;
  permissions: string[];
  isSystem?: boolean;
}

export default function RoleMatrix({ companyKey }: { companyKey: unknown[] }) {
  const qc = useQueryClient();
  const [err, setErr] = useState('');
  const [newName, setNewName] = useState('');
  const [draft, setDraft] = useState<string[]>([]);

  const catalog = useQuery<PermissionDef[]>({
    queryKey: ['permissions'],
    queryFn: () => api.get('/admin/permissions'),
  });
  const roles = useQuery<Role[]>({
    queryKey: companyKey,
    queryFn: () => api.get('/admin/roles'),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post('/admin/roles', { name: newName, permissions: draft }),
    onSuccess: () => {
      setNewName('');
      setDraft([]);
      setErr('✓ Role created.');
      qc.invalidateQueries({ queryKey: companyKey });
    },
    onError: (e: any) => setErr(e.message),
  });

  const toggle = (key: string) =>
    setDraft((d) => (d.includes(key) ? d.filter((x) => x !== key) : [...d, key]));

  const defs = catalog.data ?? [];
  const groups = [...new Set(defs.map((d) => d.group))];
  const roleList = roles.data ?? [];

  /** Mirrors authz.ts: '*' allows everything, 'resource:*' allows the resource. */
  const held = (role: Role, key: string) =>
    role.permissions.includes('*') ||
    role.permissions.includes(key) ||
    role.permissions.includes(`${key.split(':')[0]}:*`);

  if (defs.length === 0) return <Empty>Loading permissions…</Empty>;

  return (
    <div className="space-y-6">
      <Banner text={err} />

      <Card title="Permission matrix">
        <div className="overflow-x-auto">
          <Table head={['Permission', ...roleList.map((r) => r.name), 'New role']}>
            {groups.map((g) => (
              <>
                <tr key={g}>
                  <td
                    colSpan={roleList.length + 2}
                    className="px-4 py-2 text-xs uppercase tracking-wide text-muted"
                  >
                    {g}
                  </td>
                </tr>
                {defs
                  .filter((d) => d.group === g)
                  .map((d) => (
                    <tr key={d.key}>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs">{d.key}</span>
                          {d.risk === 'high' && (
                            <span className="text-[10px] uppercase tracking-wide text-owed">
                              high risk
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted">{d.description}</div>
                      </td>
                      {roleList.map((r) => (
                        <td key={r.id} className="px-4 py-2 text-center">
                          {held(r, d.key) ? '●' : '·'}
                        </td>
                      ))}
                      <td className="px-4 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={draft.includes(d.key)}
                          onChange={() => toggle(d.key)}
                          aria-label={`Grant ${d.key} to the new role`}
                        />
                      </td>
                    </tr>
                  ))}
              </>
            ))}
          </Table>
        </div>

        <div className="mt-4 flex items-end gap-3">
          <label className="text-xs uppercase tracking-wide text-muted">
            New role name
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="mt-1 block w-56 rounded-md border border-rule px-2 py-1"
            />
          </label>
          <Button
            onClick={() => create.mutate()}
            disabled={!newName || draft.length === 0 || create.isPending}
          >
            Create role
          </Button>
        </div>
      </Card>
    </div>
  );
}
```

Existing roles render read-only (`●` / `·`); only the new-role column is editable. Editing existing roles is out of scope for this task.

- [ ] **Step 2: Wire it into Admin.tsx**

In `web/src/pages/Admin.tsx`:

1. Delete the `const PERMISSIONS = [ ... ];` array at line 8.
2. Delete the `role`/`setRole2`/`togglePerm`/`createRole` state and mutation that fed the old checkbox list.
3. Delete the old roles-tab JSX block that mapped over `PERMISSIONS` (around lines 226–236).
4. Add `import RoleMatrix from '../components/RoleMatrix';` and render `<RoleMatrix companyKey={key('roles')} />` in the roles tab.

Keep every other tab exactly as it is.

- [ ] **Step 3: Verify**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: both clean. Confirm no reference to `PERMISSIONS` remains: `grep -rn "PERMISSIONS" web/src` returns nothing.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/RoleMatrix.tsx web/src/pages/Admin.tsx
git commit -m "feat(admin): permission matrix UI driven by the API catalog"
```

---

## Task 11: End-to-end verification

**Files:** none created; this is a verification gate.

- [ ] **Step 1: Full suites**

```bash
cd api && npm test && npm run typecheck
LD_LIBRARY_PATH="$PWD/node_modules/@embedded-postgres/linux-x64/native/lib" node test/integration/db-guarantees.int.mjs
cd ../web && npx tsc --noEmit && npm run build
```

Expected: all green. Integration must remain at 22 passed / 0 failed.

- [ ] **Step 2: Rebuild and restart**

```bash
cd /home/tcc-azure/openbooks && docker compose build api web && docker compose up -d api web
docker compose logs api --tail=60 | grep -c "successfully started"
```

Expected: `1`, with no dependency-resolution errors.

- [ ] **Step 3: Prove enforcement against the live API**

The bootstrap admin holds `*`, so it can do everything — that proves nothing about gating. Create a Read-only membership and confirm it is actually blocked.

Using the seeded roles, assign a second user the **Read-only** role at Doogster Industries, log in as them, and confirm:

1. `GET /api/reports/trial-balance` → **200** (Read-only holds `reports:view`)
2. `POST /api/sales/invoices` → **403** (no `sales:manage`)
3. `POST /api/checks/print` → **403** (no `checks:print`)
4. `POST /api/period-close` → **403** (no `period:close`)
5. `GET /api/payroll/employees` → **200** (Read-only holds `payroll:view`)

Then assign them **Bookkeeper** and confirm:

6. `POST /api/expenses/bills` → **200/201** (holds `expenses:manage`)
7. `POST /api/period-close` → **403** (Bookkeeper deliberately lacks `period:close`)
8. `POST /api/checks/print` → **403** (deliberately lacks `checks:print`)

Record the actual status codes in your report. A 401 instead of 403 means the session broke, not that authorization worked — investigate rather than accepting it.

- [ ] **Step 4: Prove the lockout guards**

As the bootstrap admin, attempt to assign yourself the Read-only role at a company where you are the only `user:manage` holder. Expect **409** with the message about leaving the company with nobody who can manage users. Confirm you still have access afterwards.

- [ ] **Step 5: Update project memory**

Add to `CLAUDE.md` under "Architecture notes":

```markdown
- Permissions: `api/src/auth/permissions.catalog.ts` is the SINGLE source of
  truth for grantable permissions, served to the web UI by
  `GET /admin/permissions`. A test greps every `@RequirePermissions` decorator
  and asserts the catalog and the enforced set match in BOTH directions, so a
  permission can never be offered in the UI without an endpoint enforcing it
  (the original defect) or enforced without being grantable. Adding a
  permission means adding a catalog entry AND a decorator, or the suite fails.
  `'*'` is a wildcard handled by `authz.ts`, deliberately not a catalog entry.
  Roles are org-scoped; `Membership` assigns one per user per company.
```

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: record the permission catalog invariant"
```

---

## Self-Review Notes

**Spec coverage.** §1 purpose → Tasks 1, 4–8. §3 catalog → Task 1. §3.1 drift test → Tasks 1 and 8. §4 vocabulary → Task 1. §4.1 migration of `checks:*` and `payroll:view` → Tasks 5 and 6. §5 sweep → Tasks 4–7. §6 seeded roles → Task 9. §7 lockout → Tasks 2, 3, and 11 step 4. §8 UI → Task 10. §9 error handling → Task 3 (400 unknown permission, 409 lockout) and the guard's existing 403. §10 testing → Tasks 1, 2, 8, 9, 11.

**Deliberate sequencing.** The "no phantom offers" half of the drift test is `it.todo` in Task 1 and activated in Task 8. Writing it live in Task 1 would fail for six tasks running and train an implementer to ignore a red suite. It is the only deferred assertion in the plan.

**Known judgment calls, flagged for the reviewer:** reference-data GETs (tax rates, items, payment terms) stay ungated because invoice and bill entry reads them — gating them would break document entry for anyone without `settings:manage`. Company GETs stay ungated because the app shell loads branding on every page for every user. Both are called out in their tasks rather than left silent.

**Type consistency:** `PermissionDef`, `PermissionRisk`, `PERMISSION_CATALOG`, `PERMISSION_KEYS`, `isKnownPermission`, `MemberPermissionView`, `grantsUserManage`, and `wouldOrphanCompany` are each defined once in Tasks 1–2 and referenced with identical names and signatures in Tasks 3, 9, and 10.
