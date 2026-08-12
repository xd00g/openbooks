# OpenBooks backlog

Maintained by the Dev Team. Findings come from domain audits and from the
Accounting Team via [`FEEDBACK-INBOX.md`](FEEDBACK-INBOX.md).

Ranked by risk of a real business getting **wrong numbers** or **losing data**,
not by effort. Sizes are S (< 1 pass), M (1–2 passes), L (multi-pass, needs a design note).

Status: `open` · `in progress` · `done (<sha>)` · `won't fix`

---

## ✅ P0-URGENT — remotely exploitable account takeover (CHAIN BROKEN 2026-08-12)

`books.nebulys.net` is internet-reachable via the Cloudflare tunnel, and Caddy routes
`/api/*`. The following was a complete chain from *anonymous internet* to *any account in
the deployment*, including a system admin.

**Status: the chain is broken.** Fixed in `a4b1602`, deployed to VM1 as `0e51727` on
2026-08-12. Verified after deploy: `/api/onboarding` → 403, 150 tests pass, typecheck
clean, org/company/user counts unchanged at 1/4/5. The regression suite in
`api/src/admin/__tests__/admin-org.scoping.spec.ts` was confirmed to **fail 6 of 7 against
the unfixed code**, so it pins the hole rather than merely passing.

| # | Finding | Evidence | Size | Status |
|---|---|---|---|---|
| **S1** | **`AdminOrgService` ignores the caller's organization.** Three of four org-scoped methods take `_currentCompanyId` and never use it, while running on the **RLS-bypassing** `AdminPrismaService`. `resetPassword` overwrites the password of an arbitrary `userId` deployment-wide. `PermissionsGuard` only validated `user:manage` against the attacker's *own* `X-Company-Id`. Siblings `updateUser` (deactivate anyone) and `removeMembership` (revoke anyone) have the same hole. The fourth method, `assignMembership:133`, does the check correctly — so this is an oversight, not design. | `admin-org.service.ts:126,88,164` | S | **done (`a4b1602`)** — `assertUserInOrg` / `assertCompanyInOrg` on all three. NotFound not Forbidden, and checked *before* input validation, so they don't become an id oracle. |
| **S2** | **`POST /api/onboarding` is `@Public()`** with no invite gate — its own docstring says "In production gate this behind an invite code", and no env flag exists. Anyone reaching the API mints an Owner with `permissions: ['*']`. This is the entry point that makes S1 exploitable by a stranger. | `onboarding.controller.ts:16` | S | **done (`a4b1602`)** — gated behind `ALLOW_SELF_SIGNUP`, default off. The first org is always allowed so a fresh install can still bootstrap. |
| **S3** | **`addMember` is a deployment-wide email→userId oracle.** `app_user` and `role` have no RLS (by design, they're cross-tenant), so the lookup resolves any user in the deployment and returns their internal `userId`. `updateMemberRole` also accepts a **cross-org `roleId`** unfiltered. Turns S1 from "needs a UUID" into "needs an email address". | `admin.service.ts:131,169` | S | ⚠️ **partial (`a4b1602`)** — see below. |

**The chain:** self-register an org (S2) → submit the victim's email to `addMember` to learn
their `userId` (S3) → `POST /admin/org/users/{id}/reset-password` (S1) → log in as them,
into every company they belong to. **Broken at S2 and S1.**

### ⚠️ S3 is only partially fixed — read this before closing it

Fixed: the **cross-org `roleId`** hole, in both `addMember` and `updateMemberRole`. Every
role lookup is now scoped to the caller's org or the built-in null-org roles. In
`addMember` the caller-supplied id previously went straight into the membership upsert
with no validation at all.

**Not fixed: the email→userId oracle itself.** `addMember` still resolves any email in the
deployment, because inviting an existing user by email is a legitimate flow — that's how
you grant an accountant access to a second company. Closing it properly means replacing
direct-add with an **invitation** flow (email a signed token; the membership is created
when the invitee accepts), which is M-sized and a UX change, not a patch.

This is acceptable *only because S1 closed the exploit the oracle fed*. On its own the
oracle now leaks "an account with this email exists here" to someone who already holds
`user:manage`. Track it as its own item rather than marking S3 done. `AdminOrgService.createUser:81`
has the same tell (`"A user with that email already exists."`).

### Still open — S4 through S9 are NOT fixed

Breaking the takeover chain did not touch any of these. S4 in particular means every
authenticated user, whatever their role, can still read the entire book.

| # | Finding | Evidence | Size | Status |
|---|---|---|---|---|
| S10 | **Key protection.** `FIELD_ENCRYPTION_KEY` is plaintext in `~/openbooks/.env`, on the same disk as the data it protects, and in no backup. Move to Azure Key Vault + the VM's managed identity (no bootstrap secret, access logged and revocable), behind a pluggable provider interface so self-hosters can stay on `env`. Rotation is now possible (done below), so this is the remaining half. See [`KEY-MANAGEMENT.md`](KEY-MANAGEMENT.md). | `~/openbooks/.env` | M | open |
| S11 | `api/tsconfig.json` has `include: ["src/**/*.ts"]`, so **`scripts/` is never typechecked** by `npm run typecheck` or CI. Both `backfill-encryption.ts` and `rekey-encryption.ts` are unguarded — a type error in an operational script surfaces only when someone runs it against production. Add a `tsconfig.scripts.json` + CI step. | `api/tsconfig.json:19` | S | open |
| S9 | **Replace direct-add with an invitation flow**, closing the email→userId oracle left over from S3. Email a signed token; create the membership on accept. Also removes the `createUser` "already exists" tell. | `admin.service.ts:131`, `admin-org.service.ts:81` | M | open |
| S4 | **No permission gate on core financial reads.** `permissions.coverage.spec.ts` only scans `@Post/@Patch/@Put/@Delete`; **GET handlers are entirely uncovered** and carry no `@RequirePermissions`. Any membership — even a custom role with no permissions — reads the full chart of accounts, every invoice, bill, customer, vendor, and `GET /accounts/:id/register`. `GET /company` returns the **decrypted EIN** while `PATCH /company` correctly requires `company:manage`. | `company.controller.ts:17`, `sales.controller.ts:48`, `accounts.controller.ts:27` | M | open |
| S5 | **`payment_term` has no RLS on any deploy following the documented path.** An exhaustive diff of all 26 `companyId` models against the `tenant_tables` array found **exactly one gap**. Its policy lives only in `0004_payment_terms.sql`, which `apply-sql-migrations.sh` never runs (see X7). Live DB shows it as the only tenant table with `forcerowsecurity=f` — applied by hand, out of band. It appears **zero times** in the integration harness, so the net that caught `check` cannot catch this. | `accounting_core_constraints.sql:193`, `schema.prisma:636` | S | open |
| S6 | **SSO links accounts by email with no `email_verified` check.** Against a multi-tenant or social IdP, an attacker setting an unverified email claim to a victim's address gets a session as that local user. This path also skips the `isActive` check that local login performs. *(OIDC verification itself is correct — JWKS signature, issuer, audience, expiry and nonce are all enforced.)* | `auth.service.ts:81`, `oidc.provider.ts:126` | S | open |
| S7a | ✅ **done (`3405b0d`)** — **Field encryption no longer fails open.** `EncryptionService` used to degrade to plaintext passthrough with a log warning when the key was unset, and `listEmployees` serves `ssnEncrypted` to the default Read-only role — so one misconfigured restart silently wrote SSNs in the clear. It now refuses to boot unless `ALLOW_PLAINTEXT_SECRETS=true`. The rest of S7 (rate limiting, CORS, `JWT_SECRET ?? ''`, SAML replay) is still open below. | `encryption.service.ts` | S | **done** |
| S12 | ✅ **done (`3405b0d`)** — **Key rotation is now possible.** `enc:v2:<keyId>:…` envelope + keyring config, so old and new keys are readable simultaneously. Legacy `enc:v1:` maps to key id `v1`, so no data migration is needed. `npm run rekey:encryption` (dry-run by default) upgrades values and also covers `vendor.taxId` and the employee SSN/bank columns, which the old backfill script silently skipped. Dry-run against production read all 50 encrypted values with 0 failures. | `field-crypto.ts`, `scripts/rekey-encryption.ts` | M | **done** |
| S7 | **Auth hardening.** No rate limit on `/auth/login` (also a scrypt CPU-exhaustion DoS); `enableCors({origin: true})`; **`verifyJwt(token, JWT_SECRET ?? '')` — with the secret unset, verification succeeds against the empty-string HMAC, so anyone can mint sessions** (no boot-time env assertion). The OIDC tx token shares the session secret with no `typ`/`aud`. SAML doesn't set `validateInResponseTo`, which defaults to never in v5 — assertion replay is unprevented. | `main.ts:26`, `jwt-auth.guard.ts:29`, `saml.provider.ts:27` | M | open |
| S8 | Infrastructure ports bind `0.0.0.0`, bypassing Caddy — including unauthenticated Swagger on `:3000/docs`. Compose defaults `${POSTGRES_PASSWORD:-change-me-postgres}` silently apply if `.env` is incomplete. See also X8. | `docker-compose.yml:18,32,49,82` | S | open |

**Verified clean — do not re-audit:** attachments are properly isolated (every read goes
through `prisma.forCompany`, and `presignGet` asserts the `${companyId}/` key prefix, so
company A cannot fetch company B's file); all mutating endpoints *are* gated, by a
genuinely good coverage scanner; the lockout predicate is correctly company-scoped even on
the RLS-bypassing client; no secrets are tracked in git. One latent trap: `EncryptionService`
degrades to **plaintext passthrough** with only a log warning if `FIELD_ENCRYPTION_KEY` is
unset, and `listEmployees` returns whole rows including `ssnEncrypted` to any holder of
`payroll:view` — which the default **Read-only** role has. Safe on this host (key is set);
the fail-fast env check in S7 is what keeps it that way.

## 🚨 P0-URGENT — the live system has no working backup

Live data confirmed real on `tcc-linux-vm1`: **4 companies** (Hospice Del Sol, NV IT Labs,
Doogster Industries, Nebulys Networks), 798 accounts, 19 journal entries, 883 audit rows,
403 vendors, 136 employees, 12 attachments.

| # | Finding | Evidence | Size | Status |
|---|---|---|---|---|
| **X1** | **The nightly backup backs up the wrong directory.** `restic-backup.sh` targets `/mnt/data/personal-apps` (contains only `rustdesk`) and `$STACK=~/stack`, which **does not exist**. The OpenBooks volumes at `/mnt/data/docker/volumes/openbooks_{pgdata,miniodata}` are in **no snapshot at all**. Snapshot sizes prove it: 2.9 GiB pre-wipe, then **206 KiB every night** since 2026-08-04. Not one `openbooks-*` container is in the script's quiesce list either. | `/usr/local/bin/restic-backup.sh` | S | open |
| **X2** | **Nightly alert says "backup succeeded" — every night, for a backup containing nothing.** Green light on a system with zero coverage; worse than no monitoring. | same script, ntfy + healthcheck ping | S | open |
| **X3** | **Newest recoverable copy is 12 days stale, on the same disk as the data.** Newest dump `2026-07-30 22:56`; live data runs to `2026-08-03 17:44`. The **Nebulys Networks company is in no backup that exists**. All four dump files sit on `/mnt/data` — same failure domain as the DB. | `~/openbooks-backups/` | S | open |
| **X4** | **MinIO attachments have never been copied, even once.** 12 attachments, ~2 MB. Postgres holds only object keys, so a DB-only restore yields 12 broken links to receipts and supporting documents. | `openbooks_miniodata` in no snapshot | S | open |
| **X5** | **`FIELD_ENCRYPTION_KEY` exists in exactly one file, on the same disk, in no backup.** It encrypts SSNs, bank tokens and EINs. Lose the host and even a *good* DB dump is partly permanently undecryptable. There is also **no re-encryption pass in the codebase**, so the key is currently unrotatable without data loss. | `~/openbooks/.env` (mode 600) | S | open |
| **X6** | **`docker compose run --rm migrate` runs `prisma db push` against production** as the superuser — and that exact command is what DEPLOY.md §5a and CLAUDE.md put in front of the reader as a deploy step. `db push` **drops** any column the schema no longer declares. `archive_mode=off`, so there is no PITR to rewind by even one second. Single most dangerous line in the repo. | `docker-compose.yml` migrate service | M | open |
| **X7** | **No restore has ever been performed, and the documented rebuild path is broken.** `apply-sql-migrations.sh` applies 3 of the 5 files in `api/prisma/sql/` — `0003_contact_fields.sql` and `0004_payment_terms.sql` are never applied (note the duplicate `0003_` prefix). Live DB has those objects, so they were applied *by hand* and the script drifted. A rebuild-from-repo silently produces a DB missing RLS policies and triggers — a "recovered" ledger that is editable and cross-tenant readable. | `scripts/apply-sql-migrations.sh:13` | M | open |
| **X8** | **Data tier bound to `0.0.0.0` with no host firewall; Redis has no password.** Postgres 5432, Redis 6379, MinIO 9000-9001 all reachable from the VNet (`172.16.0.4`) and the tailnet; `redis-cli ping` succeeds unauthenticated. Mitigating: no public IP, ingress is outbound-only cloudflared, and the MinIO bucket is verified `private`. But any compromised tailnet device can `FLUSHALL` today. MinIO is also **un-versioned** — a delete is final. | `docker-compose.yml` ports stanzas | S | open |
| **X9** | No rollback path. All images are `latest`, built locally, no registry — and the worker image is already 5 days older than the api image. No schema rollback exists at all. `minio/minio:latest` unpinned. No app-tier healthchecks, so `restart: unless-stopped` can't recover a hung API. | `docker images`, compose | M | open |

**Restore acceptance criteria** (record these as assertions): 31 tables, **27 with `relrowsecurity`**, 5 non-internal triggers, `openbooks_app` = `rolsuper f / rolbypassrls f`. Row counts at audit time: journal_line 45, account 798, audit_log 883, vendor 403.

The full phased baseline-migration plan (with the `migrate diff` drift gate, the
`--from-empty` destructive-statement assertion, and per-failure-mode recovery) is in
[`docs/MIGRATION-PLAN.md`](MIGRATION-PLAN.md).

## P0 — corrupts data, hides failure, or posts to the wrong place

| # | Finding | Evidence | Size | Status |
|---|---|---|---|---|
| W1 | **API errors and expired sessions render as real, empty books.** `api.ts` clears the token on 401 but never notifies `AuthProvider`, so the app keeps rendering. `money(undefined)` resolves to `$0.00`. A bookkeeper with an expired JWT sees "Total assets $0.00" and "No invoices yet." — indistinguishable from a company with no data. | `web/src/lib/api.ts:33`, `lib/format.ts:1`, `Dashboard.tsx:37`, `Sales.tsx:273` | M | open |
| W2 | **"Pay" on a bill posts to whichever bank account sorts first.** `bankAccounts[0].id`, no picker, no date. A company with Checking/Savings/Payroll gets every payment against one arbitrary account. The correct form already exists in `VendorStatements.tsx:79` (Pay from + date + allocation). | `web/src/pages/Expenses.tsx:78` | S | open |
| W3 | **Every date shows one day early west of UTC.** `@db.Date` serializes to midnight UTC; `format.ts` then localises it. Also `today()` uses `toISOString()`, so after ~5pm PT a new document defaults to *tomorrow*. Hits invoices, checks, statements, payroll pay dates. | `lib/format.ts:45`, `Payroll.tsx:129`, `schema.prisma:256` | S | open |
| W4 | **The "Reconcile" nav item cannot complete a reconciliation.** Clearing and "Complete & lock" live under a different nav item. No pending guard, so a double-click creates two `in_progress` reconciliations and the app silently picks the first. | `pages/Reconcile.tsx:54`, `Banking.tsx:31` | M | open |
| O1 | **No baseline Prisma migration.** `api/prisma/migrations` does not exist; deploys have used `prisma db push` against a live DB holding real data. Any schema change risks it. Generate `init` on a scratch DB — never the live one — and commit. | `CLAUDE.md` TODO | M | open |
| A1 | **Taxed invoices can be literally unpayable.** *(reproduced)* Money is 4dp and nothing quantizes a document total to cents. $149.99 @ 7.5% → total `161.2393`. The customer pays the collectible `161.24` and `allocatePayment` **throws**: `Allocation 161.2400 exceeds balance 161.2393`. Applying `161.2393` instead leaves the deposit $0.0007 off, and `summarizeReconciliation` requires an exact zero difference — so any reconciliation containing that deposit can never close. Every taxed invoice at a rate that doesn't divide evenly into cents seeds this. Note `document.logic.spec.ts:11` currently *asserts* the broken value. | `money.ts:12`, `document.logic.ts:75,153`, `reconciliation.logic.ts:125` | M | open |
| A2 | **After a period close, that period's P&L reports all zeros.** *(reproduced)* The closing entry is dated `asOf` with `sourceType: 'manual'` and no marker, and `activity()` aggregates every posted line in the window with no exclusion. Pre-close 2025 P&L → net income `60000`; re-run the same report after closing → `revenue 0, expenses 0, netIncome 0`. Close the year, print the annual P&L for your accountant or tax return, and it is blank. Trial Balance and Balance Sheet are unaffected. | `reporting.service.ts:50`, `period-close.service.ts:53` | S | open |

## P1 — wrong numbers in some cases, or a core task is impossible

| # | Finding | Evidence | Size | Status |
|---|---|---|---|---|
| W5 | **No double-submit protection on any posting action.** `disabled` checks form validity, not `isPending`. Double-clicking "Receive" posts two customer payments. `Checks.tsx` does it correctly — copy that. | `Sales.tsx:99,212`, `Expenses.tsx:74`, `Payroll.tsx:59`, `Banking.tsx:72` | S | open |
| W6 | **Customer payments always land in Undeposited Funds with no way out.** No `depositAccountId` sent, no deposit screen, no `/deposits` endpoint. Cash never reaches a bank account in the books, so Registers and Reconcile can never match reality. `receive()` is also full-balance-only with no allocation. | `Sales.tsx:103`, `api/src/sales/sales.service.ts:419` | M | open |
| W7 | **Money typos display `$0.00` then 500 at the server.** `cleanAmount` strips characters without validating shape: `"12.5.0"` → `NaN` → shows `$0.00` but posts the raw string; `money.ts` throws a bare `Error` → HTTP 500. `"(500)"` becomes +500. `Registers.tsx` and `Reconcile.tsx` don't clean at all, so `"1,200"` 500s. Request bodies are plain TS types, so the global `ValidationPipe` validates nothing — the UI is the only gate. | `lib/format.ts:10`, `api/src/ledger/money.ts:29`, `main.ts:22` | S | open |
| W8 | **The UI is permission-blind on 15 of 18 pages.** `can()` exists but only 3 pages use it. A Bookkeeper sees Print checks, Void, Add transaction, New account, and the whole Payroll page — every one 403s. Read-only gets the full New Invoice form, Finalize, Void, Delete. | `lib/auth.tsx:110`, `permissions.catalog.ts:100` | M | open |
| A3 | **AR/AP aging is a snapshot of *today* wearing an as-of date.** Both read *current* `balanceDue` and status; `asOf` only buckets `dueDate`. So a historical aging omits invoices since paid, includes invoices issued after `asOf`, and shows today's balances in historical buckets. The total therefore cannot tie to the Balance Sheet AR/AP at `asOf` — the first reconciliation any accountant performs. Rebuild from the ledger. | `reporting.service.ts:113,133` | M | open |
| A4 | **A "completed" reconciliation proves nothing about the books.** `complete()` checks `beginning + Σ(cleared bank_transaction) == ending` — all three from the imported statement. It's a statement-versus-itself identity that ties by construction. The GL is never consulted, and `setCleared` doesn't require a `journalEntryId`. A period can be marked reconciled while unposted bank activity sits uncategorized and GL cash is arbitrarily wrong — exactly the assurance a reconciliation exists to give. | `reconciliation.service.ts:114,161` | M | open |
| A5 | **A customer payment can never be unapplied, voided, or over-received.** `voidInvoice` tells you to "unapply payments", but no unapply endpoint exists anywhere. `Payment.voidedAt` is set in exactly one place — the vendor-check cancel path. So a payment keyed to the wrong invoice is permanent, a paid invoice can never be corrected, and **overpayment is unrepresentable** (`unappliedAmount` is hardcoded `'0'` despite the column existing). No customer credit memos or refunds exist. The bill side already does this correctly in `checks.service.ts:349` — mirror it. | `sales.service.ts:335,430`, `document.logic.ts:136` | L | open |
| A6 | **Reopening and re-closing a period double-counts the prior closing entry.** `setClosedThrough` can move `closedThrough` backward; `incomeExpenseActivity` then spans a window containing the previous closing entry, which zeroed the whole prior period. Close 2024, reopen to Nov 30, post one backdated expense, re-close: the new entry is roughly `December − FullYear`, and Retained Earnings absorbs a fabricated plug. No guard detects it. Same `isClosing` marker as A2 fixes it. | `period-close.service.ts:89,106` | S | open |
| A7 | **Discount / credit-memo lines save on a draft, then 500 on finalize.** *(reproduced)* `computeDocumentTotals` supports negative lines and two passing tests certify it — but `buildInvoicePosting` maps them to `credit: Money.of(l.amount)` and `assertBalanced` rejects negatives. `PostingError` isn't an `HttpException` and isn't caught, so it surfaces as an unhandled 500 and the invoice is stuck in draft forever. The suite actively certifies a capability that fails in production; users will work around it with hand-written JEs, which is where the real wrong numbers come from. | `posting.builders.ts:33`, `document.logic.spec.ts:23` | M | open |
| W9 | **A printed check batch is unconfirmable after a tab refresh.** `batchId` lives only in component state and there's no "pending batches" endpoint. Refresh after the PDF opens and the batch is stranded at `printed / confirmedAt: null` — a printer jam can then only be undone by voiding each check individually. | `Checks.tsx:18`, `checks.service.ts:40` | M | open |

## P2 — friction, hygiene, accessibility

| # | Finding | Evidence | Size | Status |
|---|---|---|---|---|
| W10 | **Mobile unusable; modals have no focus management.** Sidebar is a hard `w-64` with no breakpoint or hamburger; ~55px of content survives on a 375px phone; `index.css` has zero breakpoints. `Modal` has no `role="dialog"`, no focus trap, no Escape, and a backdrop click that discards an in-progress form without warning. | `App.tsx:207,252`, `ui.tsx:174` | M | open |
| W11 | `prompt()` collects invoice CC recipients, and a user's **new password in cleartext**. | `Sales.tsx:94`, `Admin.tsx:61` | S | open |
| W12 | No `ErrorBoundary` anywhere — a render throw blanks the whole app. | `web/src/App.tsx` | S | open |
| W13 | No per-document routes, so nothing is deep-linkable or shareable. | `App.tsx:253` | M | open |
| W14 | `EntityManager.tsx:101` calls `useMemo` after an early return — Rules-of-Hooks violation. Crash reachability from current nav is UNVERIFIED, but it will fail lint and break as soon as a no-company state exists. | `EntityManager.tsx:97` | S | open |
| W15 | Creating a GL account and linking it are two non-atomic calls; a failure on the second orphans the account and reports only an error. | `Registers.tsx:46` | S | open |
| A8 | **Every tax agency shares one liability account, and there's no liability report.** `createRate` resolves `bySubtype('sales_tax_payable')` unconditionally, so state, county and city rates all credit the same GL account. Nothing breaks the balance down by agency or jurisdiction, and there's no remittance flow to relieve it. A multi-jurisdiction business cannot file returns without exporting the raw ledger. Bills have no tax support at all (`taxTotal` hardcoded `'0'`), so use tax and recoverable input tax are unrepresentable. Also `tax.service.ts:44` does float math on a rate, against the no-floats rule. | `tax.service.ts:38,44` | L | open |
| A9 | `reverseEntry` skips the app-layer `assertPeriodOpen` guard that `createPostedEntry` applies — and the comment at `sales.service.ts:349` claims a check that does not exist. Contained today only because the DB trigger catches it and reversals are dated today. | `ledger.service.ts:65` | S | open |
| A10 | DB permits `posted → void`, and all reporting filters `status = 'posted'` — so flipping status erases an entry from every report with no reversing entry. **UNVERIFIED as reachable**; no app path sets it. Latent hole; close or document. | `accounting_core_constraints.sql:130` | S | open |
| A11 | Reversals are dated *today*, not the original entry date. Reverting a January invoice in March overstates January revenue and understates March. Defensible for `void`, wrong for `revert`. | `sales.service.ts:339`, `expenses.service.ts:191` | S | open |
| A12 | `allocatePayment` doesn't decrement its working map across allocations, so two allocations naming the same doc each validate against the original balance. Unreachable today only because duplicate-ID guards reject it *by accident*. | `document.logic.ts:140` | S | open |
| A13 | Float accumulation in displayed running balances, with `toFixed(2)` truncation of 4dp values — the account register and vendor statement can disagree with the Trial Balance by fractions of a cent. | `accounts.service.ts:138`, `expenses.service.ts:302` | S | open |

---

## Feature gaps — QuickBooks parity

Ranked by how fast a real small business hits the wall.

1. **Manual journal entries + period close UI.** No journal-entry endpoint exists at all, and `POST /period-close` / `/reopen` have *zero* front-end — grep for "period" in `web/src` returns nothing. An accountant cannot book an accrual, depreciation, or an opening balance, and cannot lock a filed month against back-posting. **Largest single gap.** (L)
2. **Estimates / quotes** with convert-to-invoice. No `Estimate` model. Most service businesses quote before invoicing. (L)
3. **Recurring invoices.** No schedule model; retainer and subscription businesses re-key every month. (M)
4. **Credit memos, vendor credits, customer statements.** No `CreditMemo` model; vendor statements exist but there's no customer equivalent. Needed the first time anything is returned or disputed. (L)
5. **Sales tax liability report, and tax on bills.** Tax is collected on invoices via `InvoiceTaxLine`, but no report shows what is owed to which agency at filing time, and bill lines have no tax field. (L)

Next tier: deposits (undeposited funds → bank), 1099 tracking, general ledger + cash-flow-statement reports, multi-currency (`baseCurrency` is stored but nothing reads it), class/location tracking, budgets.

## Test coverage

The accounting core is the thinnest-covered area of the codebase: 4 tests for all of
reporting, 3 for period close, 2 for payment allocation, 1 for invoice posting. Every
finding above except A4 and A8 is reachable by a pure-logic test.

Highest-value additions — write these *before* the fix:

1. A closed year's P&L still reports its net income (A2)
2. Aging grand total equals the Balance Sheet AR line at the same date (A3)
3. A discount line posts instead of 500ing (A7)
4. An exact-cents payment closes a taxed invoice (A1)
5. Re-closing after a reopen doesn't double-count (A6)

⚠️ Two **currently-passing** tests encode incorrect behaviour and must change with the
fixes: `document.logic.spec.ts:11` asserts the unpayable `161.2393` total, and `:23`
certifies negative lines that 500 on finalize.

## Payroll — sizing

Two distinct paths, and they should not be confused:

**(a) Compliant paystub for manually-entered figures — M/L, worth doing.** Add a
`PayrollLineItem` child table (type, code, description, employee/employer, amount, YTD)
— remember the two-step RLS registration in `tenant_tables` *plus* the harness stub, per
`CLAUDE.md`. Add per-employee YTD accumulators and a paystub PDF. Note CA Labor Code §226
also requires fields the schema doesn't carry at all: pay-period start/end, employer legal
name and address, last four of SSN, and **all hourly rates in effect with hours at each** —
the current single `payRate`/`hours` pair cannot express overtime or two rates. This
unblocks payroll check printing.

**(b) Actually computing withholding — XL, recommended against.** IRS Pub 15-T
percentage-method tables with 2020+ W-4 steps; FICA with the SS wage-base cap and the 0.9%
Additional Medicare threshold; FUTA with credit-reduction states; up to 50 state
jurisdictions plus locals; per-state SDI/SUI; cumulative YTD wage-base tracking (a period
can't be computed in isolation once a cap is in play); then 941/940 scheduling and W-2/W-3.
Every table changes annually in every jurisdiction — a permanent maintenance obligation,
not a one-time build. **Integrate a provider (Gusto/Check/Zeal) and post the returned
figures as a journal entry**, which `buildPayrollPosting` already handles correctly.

## Known constraints (not defects)

- Posted ledger entries are immutable by DB trigger. Every correction is a reversing entry.
