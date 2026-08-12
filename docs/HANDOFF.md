# Session handoff — OpenBooks

A narrative bridge from the Cowork design/build sessions to a Claude Code session
running on the deployment host. `CLAUDE.md` (repo root) holds the durable rules;
this file is the "where we are and why" summary.

## Where the project stands

The whole stack is built and, where possible, verified:

- Design docs (`docs/DESIGN.md`, ER diagram), Prisma schema, and the DB-level
  guarantees (RLS + balance/immutability/closed-period triggers).
- Accounting core: Money type, posting builders + `LedgerService`, chart-of-
  accounts seeder.
- Reporting: Trial Balance, P&L, Balance Sheet, AR/AP aging.
- Banking: reconciliation (match + lock) and bank-feed import (CSV/OFX/SimpleFIN).
- Period close (retained-earnings roll-forward).
- Documents: invoices, bills, payment application (keeps balances accurate).
- Payroll (light, manual). Attachments (MinIO presigned).
- Auth: local + OIDC (JWKS + nonce) + SAML; RBAC guards; onboarding; audit log.
- React UI wired to all of it (dashboard, sales, expenses, banking, accounting,
  payroll, reports, company, admin).
- Tests: pure-logic unit suite + a real-Postgres integration test; GitHub Actions CI.

## Key decisions made (and why)

- **AGPL-3.0 + CLA** for licensing — keeps it open, deters closed SaaS forks,
  preserves a commercial/hosted option (see DESIGN §18).
- **RLS via a non-superuser app role** — a superuser silently bypasses RLS, so
  the runtime `DATABASE_URL` uses `openbooks_app`; superuser is admin-only.
- **camelCase SQL identifiers** — Prisma emits camelCase columns; all raw SQL was
  fixed to quote them (this was a real bug caught by the integration test).
- **Pure-logic/I-O split** everywhere, so accounting rules are unit-testable
  without a database.

## Immediate task on this host (tcc-linux-vm1)

The other Docker apps have been migrated to a new host; this VM is being
repurposed for OpenBooks (snapshot taken / VM was off for rollback).

1. Wipe Docker: `chmod +x scripts/cleanup-docker.sh && ./scripts/cleanup-docker.sh`
   (type `WIPE` to confirm). Remove any leftover bind-mount data dirs manually.
2. Deploy per `docs/DEPLOY.md`: `.env` → data tier → schema/constraints/app-role
   → app tier → verify → CORS/TLS/hardening/backups.

## Watch-outs

- First `npm install && npx prisma generate && tsc` may surface minor type/wiring
  issues (the app was authored where Prisma's engine couldn't run). CI
  `api-typecheck` is the gate.
- Generate and commit the baseline Prisma migration before relying on
  `migrate deploy`.
- Don't expose Postgres/Redis/MinIO ports publicly — front everything with Caddy
  (and/or keep it on the tailnet).
