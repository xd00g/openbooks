# OpenBooks

*A self-hosted, open-source small-business accounting platform — a QuickBooks Online alternative.*

> **Status: pre-alpha skeleton.** This repo currently contains the architecture,
> data model, and a runnable project scaffold. No business logic is implemented yet.
> See [`docs/DESIGN.md`](docs/DESIGN.md) for the full software design.

## What this is

Double-entry accounting you can run in Docker on any hardware — a NAS, a VPS, or
the cloud. Multi-company, OIDC/SSO auth (Authentik or any OIDC provider),
bank feeds (SimpleFIN / Plaid / file import), receipt attachments, and real
financial reporting.

## Architecture at a glance

| Layer | Tech |
|---|---|
| API | NestJS (TypeScript) + Prisma |
| Web | React + Vite + Tailwind + shadcn/ui |
| DB | PostgreSQL 16 (ledger, RLS multi-tenancy) |
| Jobs/cache | Redis + BullMQ |
| Object storage | MinIO (S3-compatible) |
| Auth | Authentik (OIDC), pluggable |
| Proxy/TLS | Caddy |

See [`docs/DESIGN.md`](docs/DESIGN.md) and [`docs/er_diagram.mermaid`](docs/er_diagram.mermaid).

## Monorepo layout

```
openbooks/
├── api/                 # NestJS API + Prisma schema + SQL migrations
│   ├── prisma/          # schema.prisma + sql/ (RLS + ledger invariants)
│   └── src/             # modules (health, prisma, tenant middleware, worker)
├── web/                 # React + Vite front-end (left-nav shell)
├── docs/                # design doc + ER diagram
├── scripts/             # helper scripts (apply raw-SQL migrations)
├── docker-compose.yml   # full local stack
├── Caddyfile            # reverse proxy / TLS
└── .env.example         # copy to .env and fill in
```

## Quick start (local, dev)

Prerequisites: Docker + Docker Compose.

```bash
cp .env.example .env          # then edit secrets
docker compose up -d postgres redis minio
docker compose run --rm api npx prisma migrate deploy         # create tables
docker compose run --rm api ./scripts/apply-sql-migrations.sh # RLS + triggers
docker compose up -d          # bring up api, worker, web, caddy
```

- Web UI: http://localhost (via Caddy) or http://localhost:5173 (Vite dev)
- API: http://localhost:3000/health
- API docs (OpenAPI/Swagger): http://localhost:3000/docs
- MinIO console: http://localhost:9001

> Authentik is not in the default compose to keep the first-run simple. See
> [`docs/AUTH.md`](docs/AUTH.md) for wiring Authentik or any OIDC provider, and
> the break-glass local admin.

## The two DB-level guarantees

Prisma models the tables, but two correctness rules live in raw SQL
(`api/prisma/sql/accounting_core_constraints.sql`), applied after migration:

1. **Ledger invariants** — every posted journal entry must have
   `SUM(debit) = SUM(credit)`, each line is one-sided, and posted entries are
   immutable (corrections are made by reversing entries).
2. **Row-Level Security** — tenant isolation by `company_id`, enforced by
   PostgreSQL itself, not just app code.

## License

**AGPL-3.0-or-later.** See [`LICENSE`](LICENSE). Contributions require a CLA —
see [`CONTRIBUTING.md`](CONTRIBUTING.md). This keeps the project open, deters
closed-source SaaS forks, and preserves the maintainer's right to offer a hosted
or commercially-licensed edition. (Not legal advice.)
