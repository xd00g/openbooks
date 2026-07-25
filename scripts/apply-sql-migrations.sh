#!/usr/bin/env sh
# Applies the raw-SQL guarantees that Prisma can't express (RLS + ledger
# invariants) AFTER `prisma migrate deploy` has created the tables.
# Idempotency: re-running will error on existing objects; wrap in your migration
# tooling or guard with DROP ... IF EXISTS as you formalize migrations.
set -eu

: "${DATABASE_URL:?DATABASE_URL must be set}"

SQL_DIR="$(dirname "$0")/../api/prisma/sql"

echo "Applying accounting_core_constraints.sql ..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$SQL_DIR/accounting_core_constraints.sql"
echo "Done."
