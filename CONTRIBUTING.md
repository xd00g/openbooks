# Contributing to OpenBooks

Thanks for your interest! A few things to know before you open a PR.

## Contributor License Agreement (CLA)

OpenBooks is licensed **AGPL-3.0-or-later**. To keep the project open *and*
preserve the maintainer's ability to offer a hosted or separately-licensed
commercial edition, **all contributions require a signed CLA** granting the
project a broad license (including the right to relicense) over your
contribution. You retain copyright to your own work.

By submitting a pull request you confirm you have signed the CLA and that you
have the right to contribute the code (it is your original work or you have
permission to submit it).

> Why: without this, contributed AGPL code the project doesn't own would block
> any future commercial/dual-license offering. See `docs/DESIGN.md` §18.

## Dependency license policy

To keep relicensing options open, dependencies linked into distributable builds
must use a permissive license: **MIT, BSD, Apache-2.0, or ISC**. Copyleft
(GPL/AGPL/LGPL) dependencies must be discussed first. A license-scan step runs
in CI and will fail the build on a disallowed transitive dependency.

## Development

```bash
cp .env.example .env
docker compose up -d postgres redis minio
cd api && npm install && npx prisma generate
npm run start:dev            # API on :3000
cd ../web && npm install && npm run dev   # web on :5173
```

## Conventions

- **Money is always `Decimal(19,4)`.** Never floats. Ever.
- **Never edit a posted journal entry.** Corrections are reversing entries.
- Every tenant-scoped table carries `company_id` and is covered by RLS.
- Conventional Commits for messages (`feat:`, `fix:`, `docs:`, ...).
- Run `npm run lint && npm test` before pushing.
