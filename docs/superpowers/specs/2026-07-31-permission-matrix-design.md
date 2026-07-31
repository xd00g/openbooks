# Permission Matrix — Design

**Date:** 2026-07-31
**Status:** Approved, ready for implementation planning
**Scope:** Make the existing user → company → role → permissions model actually enforce, across the whole API, with a catalog that cannot drift from reality.

---

## 1. Purpose

The data model the user asked for already exists:

```
User → Membership(userId, companyId, roleId)   @@unique([userId, companyId])
                        ↓
              Role.permissions String[]        (org-scoped, isSystem flag)
```

`Membership` already assigns one role per user per company. `Role` already holds
a permission array. `admin.service.ts` already exposes `listRoles`, `createRole`,
`addMember`, `updateMemberRole`, `removeMember`, all gated behind `user:manage`.
`authz.ts` already implements the `resource:action` grammar with `*` and
`resource:*` wildcards.

**What does not exist is enforcement.** Two concrete defects:

1. **The permission catalog is a hardcoded frontend array** (`web/src/pages/Admin.tsx:8`)
   listing 13 permissions. Only 7 are enforced anywhere. Five — `invoice:create`,
   `bill:create`, `payment:create`, `banking:reconcile`, `report:view` — are
   enforced by **no endpoint at all**. An administrator can build a role granting
   `invoice:create` and it means nothing.
2. **78 of 121 endpoints have no permission check.** Any authenticated member of a
   company can use them regardless of role.

Current enforcement, measured:

| Controller | Endpoints | Gated |
|---|---|---|
| admin | 15 | 15 |
| system-settings | 5 | 5 |
| payroll | 10 | 7 |
| checks | 8 | 6 |
| accounts | 7 | 3 |
| bank-accounts | 5 | 3 |
| import | 2 | 2 |
| expenses | 13 | 1 |
| company | 3 | 1 |
| **sales** | **14** | **0** |
| **reconciliation** | **7** | **0** |
| **reporting** | **5** | **0** |
| **tax / items / payment-terms / attachments** | **14** | **0** |
| **period-close** | **2** | **0** |
| auth / onboarding / health | 11 | 0 (correct — pre-auth) |

Sales (invoices and customer payments) and period close are entirely open.

**Success criteria:**

- Every non-public endpoint requires a permission that exists in one catalog.
- The catalog and the enforced set cannot diverge — a test fails if they do.
- Four seeded system roles give a usable starting point without hand-building.
- No administrator can lock themselves or the company out of user management.

---

## 2. Decisions made during brainstorming

| Decision | Choice | Rationale |
|---|---|---|
| Role scope | **Org-level, unchanged** | `Membership` already picks a role per company, so a user can be Bookkeeper at one company and Read-only at another. Company-scoped roles would duplicate identical definitions and let them drift. No model change. |
| Granularity | **Hybrid** | One `:manage` per resource plus separate permissions for irreversible/sensitive actions. Follows the existing `payroll:manage` + `payroll:run` precedent. ~20 permissions keeps the matrix readable. |
| Reads | **Sensitive reads gated only** | Mutations always require a permission. Reads stay open to company members except payroll (encrypted SSNs, direct-deposit details), financial reports, attachments, and audit. |
| Read-only role | **Zero-permission role** | Works under this model with no special casing: a role with only `:view` permissions can look but not touch. |

---

## 3. The catalog — single source of truth

New file `api/src/auth/permissions.catalog.ts`. Pure, **zero imports**, per the
repo's logic/IO split.

```ts
export type PermissionRisk = 'normal' | 'high';

export interface PermissionDef {
  key: string;          // 'sales:manage'
  group: string;        // 'Documents'
  label: string;        // 'Sales & invoices'
  description: string;  // shown in the role builder
  risk: PermissionRisk; // 'high' marks irreversible/sensitive actions
}

export const PERMISSION_CATALOG: PermissionDef[] = [ /* §4 */ ];

export const PERMISSION_KEYS: string[] = PERMISSION_CATALOG.map((p) => p.key);
export function isKnownPermission(key: string): boolean;
```

Served to the web UI by a new `GET /admin/permissions` (gated `user:manage`),
which replaces the hardcoded array in `Admin.tsx`.

### 3.1 The drift test — the heart of this spec

`api/src/auth/__tests__/permissions.catalog.spec.ts` reads every
`api/src/**/*.controller.ts`, extracts every string passed to
`@RequirePermissions(...)`, and asserts **both directions**:

1. **No phantom enforcement** — every permission used by a decorator exists in
   the catalog. Prevents a typo'd decorator that can never be granted.
2. **No phantom offers** — every catalog entry is used by at least one decorator.
   Prevents exactly today's defect, where the UI offers `invoice:create` and no
   endpoint enforces it.

This test is what makes the matrix trustworthy. Without it the two lists drift
again within a release.

`'*'` is deliberately **not** a catalog entry — it is a wildcard understood by
`authz.ts`, not a grantable resource permission. The role builder offers it
separately, labelled as full access.

---

## 4. The vocabulary

Nineteen permissions in four groups.

**Core**

| Key | Covers |
|---|---|
| `company:manage` | Company profile, branding, theme |
| `user:manage` | Members, roles, org users, memberships |
| `system:manage` | SSO/SMTP and other system settings |
| `account:manage` | Chart of accounts |
| `settings:manage` | Tax rates, items, payment terms |

**Documents**

| Key | Covers |
|---|---|
| `sales:manage` | Invoices, customers, received payments |
| `expenses:manage` | Bills, vendors, bill payments |
| `banking:manage` | Bank accounts, feeds, transaction import |
| `banking:reconcile` | Reconciliation sessions |
| `checks:manage` | Check queue, history, alignment offsets |

**Sensitive reads**

| Key | Covers |
|---|---|
| `reports:view` | Financial statements, agings, trial balance |
| `payroll:view` | Employee records — encrypted SSN, direct deposit |
| `attachments:view` | Uploaded documents |
| `audit:view` | Audit log |

**High risk** (`risk: 'high'`)

| Key | Covers |
|---|---|
| `period:close` | Closing or reopening an accounting period |
| `payroll:manage` | Employee master data, payroll setup |
| `payroll:run` | Executing and posting a payroll run |
| `checks:print` | Assigning numbers and rendering check PDFs |
| `checks:void` | Voiding a check (posts a reversing entry) |

Wildcards continue to work, so a role may hold `sales:*` or `*`.

**No `journal:post`.** It was considered and deliberately excluded: the ledger
module has no controller, so manual journal entries cannot be posted over HTTP at
all today. Adding the permission would immediately fail the drift test's
"no phantom offers" direction (§3.1) — which is the test working as designed.
Add `journal:post` in the same change that introduces a manual-JE endpoint, not
before.

### 4.1 Migration of existing keys

`payroll:manage` and `payroll:run` keep their names — already correct.
`banking:reconcile` and `reports:view` become real (previously offered, never
enforced). `invoice:create`, `bill:create`, and `payment:create` are **removed**;
their endpoints are covered by `sales:manage` and `expenses:manage`. Note the old
frontend array spelled it `report:view` (singular); the catalog standardises on
`reports:view`.

Two enforced keys move. Check endpoints currently gate on `banking:manage`; they
move to `checks:print` / `checks:void` / `checks:manage`, so a role holding only
`banking:manage` loses check access by design — printing a negotiable instrument
is a distinct privilege from managing a bank account. Payroll read endpoints
currently gate on `payroll:manage`; they move to `payroll:view`, so a role needs
both to read and edit employee data.

No data migration is required — the only existing role is `Owner` with `*`, which
is unaffected by every change above.

---

## 5. Enforcement sweep

Add `@RequirePermissions(...)` to every mutating endpoint and to the sensitive
reads. Mapping by controller:

| Controller | Permission |
|---|---|
| `sales` | `sales:manage` (mutations); invoice PDF/list open to members |
| `expenses` | `expenses:manage`; `payBills` keeps `banking:manage` (it debits a bank account) |
| `reconciliation` | `banking:reconcile` |
| `bank-accounts` | `banking:manage` |
| `checks` | `checks:manage` reads, `checks:print` for print/confirm/offsets, `checks:void` for void |
| `reporting` | `reports:view` |
| `period-close` | `period:close` |
| `payroll` | `payroll:view` reads, `payroll:manage` employee data, `payroll:run` runs |
| `tax`, `items`, `payment-terms` | `settings:manage` |
| `attachments` | `attachments:view` reads, `expenses:manage` uploads |
| `accounts` | `account:manage` |
| `company` | `company:manage` |
| `import` | `banking:manage` |
| `admin` | `user:manage` (unchanged), audit read → `audit:view` |
| `auth`, `onboarding`, `health` | **ungated, deliberately** — pre-authentication |

**Convention:** list/detail GETs stay open to company members unless the resource
is in the sensitive-reads group. Every POST/PATCH/PUT/DELETE is gated.

---

## 6. Seeded system roles

`Role.isSystem` and a nullable `Role.organizationId` already exist for templates
and are currently unused. Seed four at organization creation:

| Role | Permissions |
|---|---|
| **Owner** | `*` |
| **Accountant** | Everything except `user:manage` and `system:manage` |
| **Bookkeeper** | `sales:manage`, `expenses:manage`, `banking:manage`, `banking:reconcile`, `checks:manage`, `settings:manage`, `reports:view`, `attachments:view` — deliberately **not** `period:close`, `checks:print`, `checks:void`, or any `payroll:*` |
| **Read-only** | `reports:view`, `payroll:view`, `attachments:view`, `audit:view` |

Seeding is idempotent: existing roles are matched by `(organizationId, name)` —
already a unique constraint — and left untouched if present. The existing `Owner`
role in the live database is not modified.

---

## 7. Lockout safety

Two invariants, enforced in `admin.service.ts` with unit tests over pure helpers:

1. **Self-demotion guard.** A user cannot assign themselves a role lacking
   `user:manage`, nor remove `user:manage` from a role they currently hold.
2. **Last-admin guard.** A company must always retain at least one member whose
   role grants `user:manage` (directly or by wildcard). Removing or demoting the
   final such member is rejected.

Both return `409 Conflict` with a message naming the reason. The pure predicate
(`wouldOrphanCompany(members, change)`) lives in `authz.ts` alongside the existing
permission logic and is unit-tested without a database.

---

## 8. Web UI

Rework the Admin **roles** tab from a flat checkbox list into a matrix:
permissions grouped by category down the rows, roles across the columns,
checkboxes at the intersections. High-risk permissions carry a visible marker.

The catalog is fetched from `GET /admin/permissions` — the hardcoded
`PERMISSIONS` array in `Admin.tsx` is deleted.

Built strictly on existing primitives from `web/src/components/ui.tsx` (`Page`,
`Card`, `Table`, `Button`, `Banner`, `Modal`). No new components, colours, or
design tokens. System roles render read-only; only custom roles are editable.

`Admin.tsx` is 373 lines and already carries six tabs. The roles tab moves to its
own component file to keep both readable.

---

## 9. Error handling

| Condition | Response |
|---|---|
| Permission missing | 403 (existing `PermissionsGuard` behaviour) |
| Role references an unknown permission on create/update | 400 naming the key |
| Self-demotion below `user:manage` | 409 |
| Removing/demoting the last `user:manage` holder | 409 |
| `GET /admin/permissions` without `user:manage` | 403 |

---

## 10. Testing

**Unit (no DB):**
- The drift test (§3.1), both directions.
- Catalog integrity: unique keys, every entry has a non-empty label, description, and valid group.
- `hasPermission` wildcard behaviour against the new keys, including `sales:*` and `*`.
- Lockout predicates: self-demotion and last-admin, including the wildcard case where `*` implies `user:manage`.

**Integration:** seeding is idempotent — running it twice yields one role set and
does not modify a pre-existing `Owner`.

**Manual:** create a Bookkeeper, confirm they can enter a bill but cannot close
the period, print a check, or view payroll.

---

## 11. Out of scope

- **Company-scoped custom roles** — decided against in §2; org-level roles with
  per-company assignment already cover the requirement.
- **Per-record / row-level permissions** (e.g. "only their own invoices") — RLS
  already isolates by company; finer scoping is a different feature.
- **Permission delegation or approval workflows.**
- **Changing `authz.ts`'s grammar** — the existing wildcard matching is sufficient.
- **Gating `auth`, `onboarding`, `health`** — these must remain reachable
  pre-authentication.

---

## 12. Open questions

None blocking. One to confirm during implementation: whether any endpoint in
`sales` should be split out as high-risk the way `checks:void` was — voiding a
posted invoice also reverses ledger entries. Recommend starting with
`sales:manage` covering it and splitting later if the distinction proves useful.
