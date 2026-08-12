# CLAUDE.md — OpenBooks project memory

Read this first. It captures the non-obvious decisions and conventions so a new
session can work safely without rediscovering them. Detailed docs live in
`docs/` (`DESIGN.md`, `DEPLOY.md`, `AUTH.md`).

## What this is

OpenBooks — a self-hosted, open-source double-entry accounting platform (a
QuickBooks Online alternative). Multi-company, Dockerized, API-first.

## Stack & layout

- `api/` — NestJS + Prisma + PostgreSQL. `web/` — React + Vite + Tailwind.
- Data: PostgreSQL 16 (ledger + RLS), Redis/BullMQ (jobs), MinIO (attachments),
  Caddy (proxy). All in `docker-compose.yml`.
- Auth: pluggable local / OIDC / SAML; app issues its own JWT session.

## Non-negotiable conventions (violating these breaks correctness)

- **Money is always `Decimal(19,4)`** (see `api/src/ledger/money.ts`). Never floats.
- **The ledger is immutable.** Posted journal entries are never edited/deleted —
  correct by posting a **reversing** entry. Enforced by DB triggers in
  `api/prisma/sql/accounting_core_constraints.sql`.
- **Every posted entry must balance** (Σdebit = Σcredit) — DB trigger enforces it.
- **RLS multi-tenancy:** every tenant table has `companyId`; Postgres RLS filters
  by a per-request GUC (`app.current_company`) set via `PrismaService.forCompany`.
  The app MUST connect as a **non-superuser** role (`openbooks_app`) or RLS is
  bypassed. Superuser URL (`ADMIN_DATABASE_URL`) is only for migrations + the
  onboarding/auth path. See `scripts/create-app-role.sql`, DEPLOY.md.
- **Prisma columns are camelCase** (no `@map`), tables snake_case (via `@@map`).
  Raw SQL must quote camelCase columns: `"companyId"`, `"entryDate"`, etc.
- **Pure logic is separated from I/O** and unit-tested: `*.logic.ts`,
  `*.builders.ts`, `money.ts`, `auth/crypto/*`, `authz.ts`. Keep that split when
  adding accounting rules, and add a `*.spec.ts`.

## Architecture notes

- Posting flow: documents (invoice/bill/payment/payroll) → pure builders produce
  balanced `PostingLine[]` → `LedgerService.createPostedEntry` writes them in an
  RLS-scoped tx (draft → post, because the immutability trigger blocks adding
  lines to an already-posted entry).
- Reporting/period/reconciliation read the ledger via raw SQL (camelCase-quoted).
- Audit: a global interceptor records mutating requests to `audit_log`.
- Check printing (`api/src/checks/`): vendor checks on **pre-printed voucher
  stock** — the app draws only variable data, never MICR. Numbers are per bank
  account and unique **absolutely**: voided numbers are never reissued, because
  once a number is on paper it is spent. "Void" means two different things —
  a *misprint* burns the number only (no ledger impact), a *cancel* posts a
  reversing entry and reopens the bills. `Check.confirmedAt` is the terminal
  marker that makes a committed check immune to a later misprint report; without
  it, a repeated confirm would void live checks. A payment may have many checks
  but only one active (`check_one_active_per_payment`) — that is what lets a
  misprint be reprinted while the voided row survives as the audit trail.
  Payroll checks are NOT supported: a compliant paystub must itemize deductions
  (California Labor Code §226 among others) and `PayrollLine.employeeTaxes` is
  still a single lump Decimal.
- Onboarding creates org+company+owner on the admin (RLS-bypass) connection,
  then seeds the chart of accounts on the normal path.

## Testing & CI

- `cd api && npm test` — pure-logic unit suite (no DB).
- `npm run test:int` — real-Postgres integration test (boots its own Postgres via
  embedded-postgres) proving triggers + RLS. `npm run typecheck`.
  **On a bare host `npm run test:int` fails with `libpq.so.5: cannot open shared
  object file`.** `embedded-postgres` ships its own libs but without soname
  symlinks. Create them once, then pass the path explicitly (the env var does not
  survive `npm run`):
  ```sh
  cd api/node_modules/@embedded-postgres/linux-x64/native/lib
  for f in *.so.*; do ln -sf "$f" "$(echo "$f" | sed -E 's/\.so\.([0-9]+)\..*/.so.\1/')"; done
  cd /home/tcc-azure/openbooks/api
  LD_LIBRARY_PATH="$PWD/node_modules/@embedded-postgres/linux-x64/native/lib" \
    node test/integration/db-guarantees.int.mjs
  ```
  These symlinks live in `node_modules` and do **not** survive `npm install`.
- **Adding a tenant table? Two steps, or you ship a data leak.** Declaring
  `companyId` in `schema.prisma` is not enough — RLS is applied by a loop over a
  **hardcoded** `tenant_tables` array in `prisma/sql/accounting_core_constraints.sql`.
  A table missing from that array gets no policy and no isolation. The `check`
  table shipped this way and only the integration test caught it. Also add the
  table's stub to `test/db-guarantees.harness.sql`, or the constraints file fails
  to apply and the whole integration suite dies.
- CI (`.github/workflows/ci.yml`): api-tests, api-integration, api-typecheck,
  web-build. Web build is `vite build`; type errors surface in typecheck.

## Deploying

Follow `docs/DEPLOY.md`. Order that matters: schema (`docker compose run --rm
migrate`) → constraints SQL → create `openbooks_app` role → start app tier.
First-time schema uses `prisma db push`; for change management, generate a
baseline migration (`prisma migrate dev --name init`) on a dev box and commit it,
then use `migrate deploy`.

## Known caveats / TODO

- The full NestJS app's first real compile happens in CI `api-typecheck` (it was
  authored in a sandbox that can't run Prisma's engine). Expect to fix any minor
  wiring on first `npm install && npx prisma generate && tsc`.
- MinIO needs bucket CORS for browser presigned uploads (DEPLOY.md §8).
- No committed Prisma migration yet — generate the baseline `init` migration.
- OIDC id_token is JWKS-verified; SAML uses `@node-saml/node-saml` (needs env).

## Git history note

History was maintained via a portable bundle (`openbooks.bundle`) because the
authoring environment couldn't hold git locks on a mounted folder. On a normal
machine, use git natively. If `git status` is messy, the bundle is the source of
truth: `git clone openbooks.bundle fresh`.

## Current objective

Repurpose `tcc-linux-vm1`: wipe old Docker stack (`scripts/cleanup-docker.sh`),
then deploy OpenBooks fresh per `docs/DEPLOY.md`.
