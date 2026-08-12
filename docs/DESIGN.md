# OpenBooks — Software Design Document

*A self-hosted, open-source small-business accounting platform (a QuickBooks Online alternative)*

**Status:** Draft v0.1 (design phase — no code yet)
**Date:** 2026-07-24
**Working codename:** OpenBooks (placeholder — rename freely)

---

## 1. Purpose & Guiding Principles

The goal is a Docker-deployable, self-hostable, web-based double-entry accounting system that a small business can run in place of QuickBooks Online. It must run on any hardware (a NAS, a $5 VPS, or a corporate cloud), enforce industry-standard authentication and permissions, connect to bank accounts, let users attach source documents (receipts/bills) to transactions, and produce correct financial reports.

Design principles, in priority order:

1. **Correctness before features.** The ledger is sacred. Double-entry integrity, immutable posted entries, and an auditable trail come before any UI polish. A pretty app that loses a penny is worthless.
2. **Boring, proven technology.** Financial software lives for a decade. Favor mature, well-documented, widely-hired-for tools over novelty.
3. **Self-host first.** Everything ships in containers with a single `docker compose up`. No mandatory SaaS dependency. External services (bank feeds, auth) are pluggable and optional.
4. **Multi-company from day one.** The data model assumes many companies (tenants) per instance, with hard data isolation.
5. **API-first.** The web UI is just the first client of a documented REST API. This makes automation, integrations, and future mobile apps possible.

### Scope for v1 (agreed)

- **Bookkeeping + light payroll.** Full core accounting; employee records, roles, and *manual* payroll entry — but **no** automated payroll-tax calculation or filing in v1.
- **Multi-company, shared instance** with tenant isolation.
- Recommended stack (below), Postgres backend, Docker deployment.

---

## 2. Prior Art & Positioning

Worth studying before building — each teaches a lesson:

| Project | Stack | License | Takeaway |
|---|---|---|---|
| **Bigcapital** | Node/NestJS + React + MySQL/Knex | AGPL | Closest analog: open-source QBO/Xero/Wave alternative, Docker self-host, has bank import. Study its module boundaries and report set. |
| **Firefly III** | PHP/Laravel + MySQL | AGPL | Excellent self-host UX and importer design, but personal-finance oriented (not true double-entry business accounting). |
| **Akaunting** | PHP/Laravel + MySQL | GPL | Multi-company, invoicing, app marketplace. Good reference for the company-switcher pattern. |
| **Ledger/hledger/Beancount** | Plain-text CLI | Various | The purest double-entry data models. Steal their conceptual rigor even though we use a database. |

**Positioning vs. these:** our differentiators are (a) native OIDC/SSO via Authentik rather than bolt-on auth, (b) first-class document attachments to any transaction, and (c) a clean, deliberately simple left-nav UX mirroring the QBO mental model.

**Licensing note:** the strongest peers use **AGPL-3.0**. If you want to keep the project open and prevent a competitor from running a closed SaaS fork, AGPL is the natural choice. If you'd rather allow permissive commercial embedding, choose Apache-2.0. This is a decision to make early because it affects contributions — flagged in §16.

---

## 3. Recommended Technology Stack

**Recommendation: a TypeScript backend + TypeScript React frontend, PostgreSQL database.** One language end-to-end keeps the contributor pool large, shares types between API and UI, and matches the most successful direct peer (Bigcapital).

| Layer | Recommendation | Why |
|---|---|---|
| **Language** | TypeScript (Node 22 LTS) | One language front-to-back; huge hiring pool; strong typing catches money-handling bugs at compile time. |
| **Backend framework** | **NestJS** | Opinionated, modular, DI-based structure that maps cleanly to accounting modules; batteries-included (validation, guards, OpenAPI generation). |
| **ORM / query layer** | **Prisma** for schema + typed CRUD, with **raw SQL** for reporting and posting logic | Prisma gives type-safe models and migrations; hand-written SQL for the ledger/reports where correctness and performance matter most. |
| **Frontend** | **React + Vite + TypeScript**, **TanStack Query** (server state), **shadcn/ui + Tailwind** (clean, accessible components) | Fast, modern, the shadcn/Tailwind combo yields the "sleek, simple" look you described with minimal custom CSS. |
| **Database** | **PostgreSQL 16+** | See §4 — the right choice for financial data (numeric type, constraints, row-level security, JSONB, strong transactional guarantees). |
| **Cache / queue** | **Redis** + **BullMQ** | Background jobs: bank-feed sync, report generation, email, payroll runs. |
| **Object storage** | **S3-compatible (MinIO bundled, or external S3/R2/B2)** | Receipt/document attachments — see §10. |
| **Auth** | **Authentik** as the OIDC provider; app is an OIDC **relying party** | See §8. |
| **Reverse proxy / TLS** | **Caddy** (auto-HTTPS) or Traefik | One-line TLS for self-hosters. |
| **Containerization** | Docker + Docker Compose (Helm chart later for k8s) | Meets "runs on any hardware / cloud or self-host." |

**Why not Python (Django/FastAPI)?** Entirely viable and arguably better for the data/reporting side. The deciding factor is end-to-end type sharing and the larger web-app contributor pool for an open-source project. If your own team is stronger in Python, flip the backend to **FastAPI + SQLModel/SQLAlchemy + Alembic** and keep everything else — the architecture below is deliberately language-agnostic.

---

## 4. Database Architecture

### 4.1 Engine: PostgreSQL

Non-negotiable requirements for accounting and why Postgres wins:

- **Exact decimal math.** All monetary amounts stored as `NUMERIC(19,4)` — never floats. Postgres `NUMERIC` is arbitrary-precision and exact.
- **Strong transactions (ACID).** A journal entry that debits and credits must commit atomically or not at all. Postgres serializable isolation is available where needed.
- **Constraints as a safety net.** `CHECK` constraints, foreign keys, and deferrable constraints let the *database itself* refuse an unbalanced entry.
- **Row-Level Security (RLS).** Native RLS enforces tenant isolation at the engine level (defense in depth beyond app code).
- **JSONB** for flexible, schema-light data (integration payloads, custom fields, audit snapshots).

Store money as either a single `NUMERIC(19,4)` **plus** a `currency` code column, or as integer minor units (`BIGINT` cents) — the doc assumes `NUMERIC` for readability. Pick one convention and enforce it everywhere.

### 4.2 Multi-Tenancy Model

Three common patterns; the recommendation for your "multi-company, shared instance" requirement:

| Pattern | Isolation | Ops cost | Verdict |
|---|---|---|---|
| DB-per-tenant | Strongest | High (migrations × N) | Overkill for SMB scale |
| Schema-per-tenant | Strong | Medium | Good middle ground; harder cross-tenant reporting |
| **Shared schema + `company_id` + RLS** | Strong (enforced by RLS) | Low | **Recommended** |

**Recommended: shared-schema with a `company_id` on every tenant-scoped table, enforced by PostgreSQL Row-Level Security.** The app sets `SET app.current_company = <uuid>` per request (via a connection-pool hook), and RLS policies transparently filter every query. Even a buggy query cannot leak another company's data because the policy is applied by the database. This gives near schema-per-tenant safety at shared-schema simplicity.

Layered on top:

- An **Organization** (top level, billing/ownership boundary) can own **many Companies**.
- A **User** can belong to many Organizations/Companies with different roles in each (the QBO "switch company" experience).
- The UI has a **company switcher**; the selected company scopes all data.

### 4.3 Migrations & seeding

Prisma Migrate (or Alembic if Python) for versioned schema changes. Ship a **seed of standard Chart-of-Accounts templates** (e.g., a general US small-business CoA, a services CoA, a retail CoA) so new companies aren't blank.

---

## 5. The Accounting Core (Data Model)

This is the heart of the system. Everything else is CRUD around it.

### 5.1 The immutable double-entry ledger

Two-table pattern, the standard for double-entry systems:

- **`journal_entry`** (the "header"): id, company_id, entry_date, memo, source_type (invoice/bill/payment/bank/manual/payroll), source_id, created_by, posted_at, status (`draft` | `posted` | `void`), currency.
- **`journal_line`** (the "detail"): id, journal_entry_id, account_id, debit `NUMERIC(19,4)`, credit `NUMERIC(19,4)`, entity_type/entity_id (optional link to customer/vendor/employee), memo, dimensions (class/location/project via JSONB or FK).

**Invariants enforced at the DB level:**

1. For every `journal_entry`, `SUM(debit) = SUM(credit)` (enforced by a deferred constraint trigger, checked at commit).
2. A posted entry is **immutable**. Corrections happen by **reversing** entries or **voiding**, never by editing history. This is what makes the system auditable and audit-defensible.
3. Every line has exactly one of debit/credit non-zero (CHECK constraint).

Everything a user does — sending an invoice, paying a bill, importing a bank transaction, running payroll — ultimately **posts a journal entry**. The higher-level documents (invoices, bills) are *subledgers* that summarize into the GL.

### 5.2 Chart of Accounts

- **`account`**: id, company_id, code, name, type (`asset` | `liability` | `equity` | `income` | `expense`), subtype (e.g., `accounts_receivable`, `bank`, `cogs`), parent_id (for hierarchy/sub-accounts), currency, is_active, is_system.
- Account **type determines normal balance** and drives every report. Certain accounts are **system accounts** (AR, AP, Retained Earnings, Undeposited Funds, Opening Balance Equity, Sales Tax Payable) that the app manages and protects from deletion.

### 5.3 Subledgers & business objects

| Object | Purpose | Posts to GL as |
|---|---|---|
| **Customer** | AR entity | — |
| **Vendor** | AP entity | — |
| **Invoice** (+ line items) | Money owed to you | Dr Accounts Receivable / Cr Income (+ Cr Sales Tax Payable) |
| **Bill** (+ line items) | Money you owe | Dr Expense/Asset / Cr Accounts Payable |
| **Payment received** | Customer pays invoice | Dr Bank/Undeposited / Cr Accounts Receivable |
| **Bill payment** | You pay a bill | Dr Accounts Payable / Cr Bank |
| **Bank transaction** | Imported feed item | Dr/Cr Bank / Cr/Dr categorized account |
| **Item / Product-Service** | Reusable line for invoices/bills | maps to income/expense/inventory accounts |
| **Tax rate / Tax agency** | Sales-tax tracking | Cr Sales Tax Payable |
| **Journal entry (manual)** | Adjustments, accruals, depreciation | any |

### 5.4 Bank & reconciliation model

- **`bank_account`**: links a GL account of subtype `bank` to an external feed source (SimpleFIN/Plaid item) + last-sync cursor.
- **`bank_transaction`**: raw imported items (date, amount, description, external_id, status `unmatched`/`matched`/`ignored`), with a **matching engine** that suggests existing journal entries or proposes a categorization → posts a journal entry on confirm.
- **`reconciliation`**: statement-based reconcile (statement date, ending balance, cleared lines) producing a locked reconciliation record — the classic month-end "check the box until it balances" flow.

### 5.5 Audit trail

An append-only **`audit_log`** (who, what table, before/after JSONB snapshot, timestamp, request id) for every mutation. Combined with immutable posted entries, this satisfies the "who changed what" question auditors and owners ask.

---

## 6. Modules & Navigation

The left-hand pane maps directly to modules. Proposed structure (mirrors and extends your list):

```
┌─────────────────────────┐
│  [Company Switcher ▼]    │
├─────────────────────────┤
│  🏠 Dashboard            │  KPIs: cash, AR aging, AP due, P&L snapshot
│  🏦 Banking              │  Feeds, transaction review, reconciliation
│  🧾 Sales                │  Customers, Invoices, Estimates, Payments received
│  💳 Expenses             │  Vendors, Bills, Bill payments, Expenses
│  📚 Accounting           │  Chart of Accounts, Journal Entries, GL
│  👥 Employees & Payroll  │  Employees, Roles, Manual payroll runs, Benefits
│  📊 Reports              │  Financials + management reports
│  🏢 Company              │  Company info (EIN, address, logo), settings
│  👤 Admin                │  Users, permissions, integrations, audit log
└─────────────────────────┘
```

**Company** (settings): legal name, DBA, EIN/Tax IDs, addresses, logo and branding shown on invoices, fiscal year start, base currency, invoice/estimate numbering, sales-tax setup, and feature toggles.

**Employees & Payroll (light, v1):** employee master records (contact, comp, tax status, direct-deposit info stored encrypted), role assignments, benefit line definitions, and **manual payroll runs** — you enter gross, deductions, and taxes; the system posts the correct journal entries (Dr wage/payroll-tax expense, Cr cash, Cr liabilities) and tracks payroll liabilities. It does **not** compute withholding or file returns in v1 (see §12 for why and the phase-2 path).

**Reports (see §11)** — the module that most defines "is this real accounting software."

---

## 7. High-Level Architecture

```
                         ┌───────────────────────────┐
                         │  Caddy / Traefik (TLS)     │
                         └─────────────┬─────────────┘
                                       │
             ┌─────────────────────────┼──────────────────────────┐
             │                         │                          │
     ┌───────▼───────┐        ┌────────▼────────┐        ┌────────▼────────┐
     │  Web UI (SPA) │        │  API (NestJS)   │        │   Authentik     │
     │ React + Vite  │◀──────▶│  REST + OpenAPI │◀─OIDC─▶│  (IdP / SSO)    │
     └───────────────┘        └───┬────────┬────┘        └─────────────────┘
                                   │        │
                    ┌──────────────┘        └───────────────┐
                    │                                        │
            ┌───────▼───────┐   ┌──────────────┐   ┌────────▼────────┐
            │ PostgreSQL 16 │   │ Redis + Bull │   │ MinIO (S3 API)  │
            │  (ledger)     │   │ (jobs/cache) │   │  (attachments)  │
            └───────────────┘   └──────┬───────┘   └─────────────────┘
                                        │
                        ┌───────────────┴────────────────┐
                        │  Worker (NestJS jobs)           │
                        │  bank sync · reports · email     │
                        └───────────────┬─────────────────┘
                                        │
                        ┌───────────────▼─────────────────┐
                        │ External: SimpleFIN / Plaid      │
                        │           SMTP                    │
                        └──────────────────────────────────┘
```

Containers: `proxy`, `web`, `api`, `worker`, `postgres`, `redis`, `minio`, `authentik-server`, `authentik-worker`. Everything but the external feed and SMTP runs locally.

---

## 8. Authentication & Authorization

### 8.1 Authentication — Authentik via OIDC

The app is an **OpenID Connect relying party**; **Authentik** is the identity provider. This is the "native Authentik" experience done the industry-standard way:

- On login, the app redirects to Authentik (Authorization Code flow + PKCE). Authentik handles the password/MFA/passkey/SSO, then returns an ID token + access token.
- The app maps the OIDC `sub` to a local `user` record on first login (just-in-time provisioning), reading email/name/groups from claims.
- **Group → role mapping:** Authentik groups (e.g., `openbooks-admins`) map to app roles. This lets an org manage access centrally.
- **Bundled, not required:** ship Authentik in the compose file for turnkey self-hosting, but because it's standard OIDC, any OIDC provider (Keycloak, Google Workspace, Entra ID, Auth0) works too. Don't hard-code Authentik specifics.
- Keep a **local emergency admin** (username/password, break-glass) so a misconfigured IdP can't lock everyone out.

### 8.2 Authorization — RBAC scoped per company

Permissions are checked in the API (guards/policies), independent of the IdP. Model:

- **`role`** (per company or system-defined templates): Owner, Admin, Accountant, Bookkeeper, Sales, Payroll Admin, Read-only/Auditor.
- **`permission`**: fine-grained verbs on resources (`invoice:create`, `journal:post`, `payroll:run`, `report:view`, `banking:reconcile`, `company:manage`, `user:manage`).
- **`membership`**: (user × company × role) — a user can be Accountant at Company A and Read-only at Company B.
- Sensitive fields (SSNs, bank/direct-deposit numbers) gated behind extra permissions and always encrypted at rest (§13).

The **RLS `company_id` isolation (§4.2) is the backstop**; RBAC governs *what* a permitted user can do within their company.

---

## 9. Bank Feed Integration

### 9.1 Provider recommendation

Two realistic options, and they serve different audiences — so **support both behind one adapter interface**:

| | **SimpleFIN Bridge** | **Plaid** |
|---|---|---|
| Model | Read-only aggregation protocol | Full fintech data platform |
| Cost | ~**$15/year per user**, flat | Free trial (cap ~10 production items as of Apr 2026); then **per-API-call** (~$0.10–$0.60) and enterprise minimums (~$1k+/mo) |
| Best for | Self-hosters, privacy, hobby/SMB | Larger deployments, richer data, more institutions |
| Coverage | Thousands of US institutions, daily refresh | Broadest coverage, more real-time |
| Fit for this project | **Default recommendation** — matches the self-host, low-cost ethos and is what comparable tools (Actual Budget) use | Optional "power" provider |

**Recommendation:** ship **SimpleFIN as the default** bank-feed provider (cheap, privacy-friendly, self-host-aligned), and provide a **Plaid adapter** for users who need broader coverage or already have Plaid. Also always support **manual OFX/QFX/CSV import** as a zero-dependency fallback — many small businesses will start there.

### 9.2 Adapter design

Define a `BankFeedProvider` interface: `linkAccount()`, `listAccounts()`, `fetchTransactions(cursor)`, `getBalance()`. Concrete implementations: `SimpleFinProvider`, `PlaidProvider`, `FileImportProvider`. The rest of the app only knows the interface, so adding providers later (GoCardless/Nordigen for EU, etc.) is a drop-in.

Sync runs as a scheduled BullMQ job; imported items land in `bank_transaction` as `unmatched` and flow through the matching/categorization UI (§5.4). Store provider tokens encrypted (§13).

---

## 10. Document Attachments

- Any transaction (invoice, bill, expense, journal entry, bank transaction) can have one or more attachments.
- **`attachment`**: id, company_id, entity_type, entity_id, filename, mime_type, size, storage_key, checksum (SHA-256), uploaded_by, created_at.
- Files stored in **S3-compatible object storage** (bundled MinIO for pure self-host; external S3/R2/B2 for cloud) — *never* in the database as blobs (keeps the DB small and backups fast).
- Upload via **pre-signed URLs** (browser → storage directly), so large receipt scans don't stream through the API.
- Server-side generation of thumbnails/PDF previews as a worker job. Optional phase-2: OCR (Tesseract) to auto-suggest vendor/amount/date from a receipt image.
- Access is permission-checked and company-scoped; storage keys are namespaced by company.

---

## 11. Reporting Engine

Reports are the product's credibility. All reports derive from the immutable ledger — a single source of truth — so they always tie out.

**Architecture:** a reporting layer that runs parameterized SQL against the ledger (with date ranges, comparison periods, accounting method, and dimension filters), returning a normalized report structure the UI renders and can export to **PDF / XLSX / CSV**. Cache expensive reports in Redis; invalidate on new postings.

**v1 report set (the standard SMB kit):**

- **Financial statements:** Profit & Loss (Income Statement), Balance Sheet, Statement of Cash Flows, Trial Balance, General Ledger detail.
- **Accounting method toggle:** **cash vs. accrual** (critical — many SMBs report on cash basis; the engine computes both from the same accrual-recorded ledger).
- **Comparison & periods:** month/quarter/year, prior-period and budget comparison, custom ranges.
- **AR:** Aging Summary & Detail, Open Invoices, Customer Balance.
- **AP:** Aging Summary & Detail, Unpaid Bills, Vendor Balance.
- **Sales tax liability** report.
- **Banking:** reconciliation reports, uncategorized transactions.
- **Payroll (light):** payroll summary and liability by period.
- **Exports:** every report to PDF/XLSX/CSV; **1099 vendor totals** export (US) for year-end.

**Phase 2:** custom report builder, saved report packages, class/location/project (dimensional) P&Ls, budgeting.

---

## 12. Payroll (Light) — v1 Scope & the Honest Caveat

Payroll is where accounting apps get dangerous. Correct **payroll-tax withholding and filing** requires continuously-updated federal/state/local tax tables, wage-base tracking, deposit schedules, and form generation (941, 940, W-2, state equivalents). Getting it wrong exposes the business to penalties. This is why QuickBooks charges a monthly add-on and why most open-source tools *don't* attempt automated tax filing.

**v1 (light payroll) does:**

- Employee master records (comp, pay schedule, tax filing status, encrypted SSN & direct-deposit).
- Roles/permissions for payroll access.
- Benefit and deduction definitions.
- **Manual payroll runs:** the user (or their payroll service) supplies gross, taxes withheld, employer taxes, and deductions; the system records the run and **posts correct journal entries** — wage expense, employer payroll-tax expense, and the matching liabilities (taxes payable, benefits payable) — then tracks those liabilities until paid.
- Payroll reports and liability tracking.

**v1 explicitly does NOT:** compute withholding, track deposit due dates, or generate/file tax forms.

**Phase-2 path:** either (a) integrate a payroll tax engine/API (e.g., a service that returns withholding calculations and handles filings) rather than maintaining tax tables yourself, or (b) build a US withholding calculator against IRS Pub 15-T + state tables with a clear "not tax advice / verify" posture. Recommend (a) — outsource the regulatory treadmill.

This scope should be surfaced in the UI so users don't assume automated compliance.

---

## 13. Security, Compliance & Data Protection

- **Encryption at rest for sensitive fields:** SSNs, bank/routing numbers, direct-deposit details, and provider tokens encrypted with app-level envelope encryption (a KMS or a key from env/secret store), on top of full-disk/volume encryption.
- **TLS everywhere** via the bundled proxy (auto-HTTPS with Caddy).
- **Secrets** via environment/Docker secrets, never in the image or repo.
- **RLS tenant isolation** (§4.2) as defense-in-depth.
- **Immutable ledger + audit log** (§5) for financial auditability.
- **RBAC + least privilege** (§8.2); sensitive-field gating.
- **Backups:** documented `pg_dump` + object-storage sync strategy; point-in-time recovery guidance; restore drills in the docs. For accounting data, backups are a feature, not an afterthought.
- **PII/compliance posture:** document data handling for GDPR/CCPA where relevant; provide data export and deletion tooling. Note that hosting others' financial data may bring SOC 2 expectations if offered as a service — out of scope for self-host, but worth a doc note.
- **Rate limiting, CSRF/CORS, input validation** (NestJS pipes/guards), dependency scanning in CI.
- **Not legal/tax advice:** ship a clear disclaimer; the software records and reports, it does not replace an accountant.

---

## 14. Deployment

- **Primary artifact:** a `docker-compose.yml` bringing up proxy, web, api, worker, postgres, redis, minio, and Authentik — with a `.env` for secrets and provider keys. Target: `docker compose up` → working instance.
- **Runs anywhere:** amd64 + arm64 images (works on a Raspberry Pi/NAS or a cloud VM). No hard cloud dependency.
- **Cloud-hosted option:** same images behind managed Postgres/S3 if desired; env-swap only.
- **Kubernetes:** a Helm chart as a later deliverable for larger deployments.
- **Upgrades:** versioned DB migrations run on startup (guarded), semantic-versioned releases, documented upgrade/rollback path.
- **Observability:** structured logs, health/readiness endpoints, optional Prometheus metrics.

---

## 15. API & Frontend Notes

- **REST API** with an auto-generated **OpenAPI** spec (NestJS does this from decorators). Versioned (`/api/v1`). The web SPA consumes it; third parties and future mobile apps can too.
- **Idempotency keys** on money-moving endpoints (posting, payments) to prevent double-posting on retries.
- **Frontend:** React SPA, TanStack Query for server cache, optimistic UI only for non-financial actions (never fake a posted entry). shadcn/ui + Tailwind for the clean, minimal aesthetic; a persistent left-nav + company switcher; keyboard-friendly data entry (accountants live in the keyboard).
- **Number formatting/i18n:** locale-aware currency display; multi-currency is a phase-2 consideration (design the schema to allow it now — currency columns already present — but don't build FX revaluation in v1 unless needed).

---

## 16. Phased Roadmap

**Phase 0 — Foundations (weeks):** repo, license decision, CI, Docker skeleton, Postgres schema for accounts + journal, RLS multi-tenancy, Authentik OIDC login, company/user/role management, seed CoA templates. *Milestone: log in, create a company, post a manual balanced journal entry, see a Trial Balance.*

**Phase 1 — Core bookkeeping:** Chart of Accounts UI, manual journal entries, customers/invoices/payments (AR), vendors/bills/payments (AP), items, sales tax, attachments (MinIO + pre-signed uploads). *Milestone: run a real month of books; P&L and Balance Sheet tie out.*

**Phase 2 — Banking & reports:** SimpleFIN adapter + file import, bank-transaction matching/categorization, reconciliation, the full v1 report set with cash/accrual toggle and PDF/XLSX export. *Milestone: connect a bank, reconcile a statement, export financials.*

**Phase 3 — Employees & light payroll:** employee records, roles, benefits, manual payroll runs posting correct entries, payroll reports, 1099 export. *Milestone: record a payroll run and see liabilities tracked.*

**Phase 4 — Polish & scale:** Plaid adapter, dashboards/KPIs, budgeting, dimensions (class/location/project), Helm chart, OCR on receipts, custom report builder.

**Phase 5+ (stretch):** automated payroll tax via external engine, multi-currency with FX revaluation, bank rules/automation, public API tokens & webhooks, mobile app.

---

## 17. Open Decisions (need your input before/at coding)

1. **License:** AGPL-3.0 + CLA (recommended — protects against closed SaaS forks while preserving your right to sell a hosted/commercial version) vs. Apache-2.0 (permissive). See §18 for the full analysis. Affects contributions and business model.
2. **Backend language:** confirm TypeScript/NestJS, or prefer Python/FastAPI given your team's strengths.
3. **Money storage convention:** `NUMERIC(19,4)` + currency (recommended) vs. integer minor units.
4. **Default bank provider:** confirm SimpleFIN-first + Plaid-optional + file-import fallback.
5. **Multi-currency in v1?** Recommend schema-ready but not built. Confirm.
6. **Payroll phase-2 approach:** external tax engine vs. self-maintained tables.
7. **Hosting target for the reference deployment:** pure self-host (MinIO/Authentik bundled) as the documented default — confirm.

---

## 18. Licensing & Business Model

The goal: keep the project genuinely open, deter competitors from taking it closed-source as a hosted service, **and** preserve your own ability to sell it as SaaS or under a commercial license. **AGPL-3.0 plus a Contributor License Agreement (CLA) achieves all three.**

### 18.1 Why you can still sell it as SaaS

A license grants rights to *others*; it does not bind the **copyright holder**. If you own the copyright to the code, you are not a "licensee" of your own work — you can use, host, sell, and even relicense it however you want, regardless of the AGPL text. AGPL constrains everyone you give the code to, not you. Releasing under AGPL publicly while running a closed, paid hosted version yourself is a well-established model (this is "open-core" / dual-licensing — MongoDB, GitLab, Sentry, and Bigcapital all do variants of it).

### 18.2 What AGPL does *for* you

AGPL-3.0's **Section 13** closes the "SaaS loophole" left by ordinary GPL: if anyone runs a **modified** version of your software as a network service, they must offer their users the complete corresponding source, including their modifications. Effect: a competitor cannot fork OpenBooks, improve it privately, and out-compete you with a closed hosted product. They'd have to publish their changes — which removes most of the incentive to fork against you. That defensive property is the main reason to prefer AGPL over MIT/Apache for a project with a commercial angle.

### 18.3 The catch: contributions

The moment you accept outside contributions, **those contributors own the copyright to their changes**, and their code reaches you under AGPL. Once your codebase contains AGPL code you don't own, you can no longer unilaterally relicense the whole thing — which would block selling a closed/OEM build or changing the license later.

**Fix: require a CLA (or copyright assignment) on every contribution.** A CLA grants you (or a foundation you control) the right to relicense contributed code. This is exactly how the dual-license companies preserve their freedom to sell commercial versions while accepting community PRs. Options, strongest to lightest:

- **Copyright assignment** — contributor transfers copyright to you. Maximum flexibility; higher friction, can deter contributors.
- **CLA with broad relicensing grant** (recommended) — contributor keeps copyright but grants you the right to license their contribution under any terms, including commercial. Standard, tooling exists (e.g., CLA Assistant bots on GitHub).
- **DCO (Developer Certificate of Origin)** — only certifies the contributor has the right to submit; does **not** grant relicensing rights. Lighter, but insufficient if you want to keep a commercial dual-license option open.

### 18.4 Dependency license hygiene

Your relicensing freedom can be silently constrained by **dependencies**. Pulling in a library under a copyleft or incompatible license can limit what you may ship in a commercial build. Policy to adopt from day one:

- Maintain an allowlist of acceptable dependency licenses (MIT, BSD, Apache-2.0, ISC) for anything linked into distributable/commercial builds.
- Run automated **license scanning** in CI (e.g., a license-check step) to catch a disallowed transitive dependency before it lands.
- Treat AGPL/GPL/LGPL dependencies with care and document any that are included.

### 18.5 Practical obligations if you *do* distribute/host the AGPL build

- Users of your AGPL (community) deployment are entitled to the corresponding source — inherent to the license, and fine for an open project.
- Keep the commercial/SaaS offering's value in things AGPL doesn't force you to give away: hosting/ops, support SLAs, managed backups, onboarding, and any **proprietary add-on modules you keep out of the open-source repo** (a common open-core split).

### 18.6 Recommended setup

**AGPL-3.0 for the public repository + a CLA on all contributions + a dependency-license allowlist enforced in CI.** This keeps OpenBooks open, discourages closed forks, and leaves you free to sell a hosted service or a separately-licensed commercial edition.

> **Not legal advice.** License enforceability, what counts as a "modified" network work, CLA drafting, and jurisdictional nuances are genuinely fact-specific. Because this is foundational and costly to unwind, have a software-licensing attorney review the license choice and CLA before launch.

---

*Next step suggestion: turn §5 (the accounting core) into a concrete Prisma schema + ER diagram, since every other module depends on it. We can do that as the first artifact once the open decisions in §17 are settled.*
