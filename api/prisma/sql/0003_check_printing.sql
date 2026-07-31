-- ============================================================================
-- 0003 — Check printing: RLS + numbering guarantees for the "check" table
--
-- Idempotent DDL for the vendor check-printing feature. Safe to run on a live
-- database, including a database where `accounting_core_constraints.sql` has
-- already been applied once (that file's own statements are NOT idempotent —
-- see the note in scripts/apply-sql-migrations.sh — so it cannot be re-run to
-- pick up new tables added after the first apply). This file exists so the
-- check-printing DB guarantees can reach a live database without touching
-- anything already in place. Apply with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 0003_check_printing.sql
--
-- Contents mirror accounting_core_constraints.sql exactly for the "check"
-- table (RLS + the two partial unique indexes) — that file remains the
-- source of truth for FRESH installs (prisma migrate + constraints file, no
-- history yet); this file is what re-applies those same guarantees to a
-- database that already has everything else. Keep the two in sync if the
-- check-printing invariants ever change.
--
-- NOTES
--  * "check" is a SQL reserved word and must stay quoted.
--  * The DML grant below is not redundant busywork: scripts/create-app-role.sql
--    granted `ALL TABLES IN SCHEMA public` at a point in time, and the "check"
--    table did not exist yet when that ran on the live database. Without this
--    grant, openbooks_app may have zero privileges on "check" and every check
--    query will fail even though RLS is configured correctly.
-- ============================================================================

-- 1. Row-level security — tenant isolation ----------------------------------
ALTER TABLE "check" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "check" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "check";
CREATE POLICY tenant_isolation ON "check"
  USING ("companyId" = current_company_id())
  WITH CHECK ("companyId" = current_company_id());

-- ============================================================================
-- CHECK NUMBERING
-- Uniqueness is ABSOLUTE and deliberately does NOT exclude voided rows.
-- Once a number is printed onto paper it is spent, whether that paper was
-- cashed, jammed, or shredded. Reusing it would put two physical checks with
-- the same number into circulation, which is ambiguous on a bank statement
-- and breaks reconciliation. Gaps are expected; voided rows are retained so
-- the sequence stays auditable.
-- "check" is a SQL reserved word and must stay quoted.
-- ============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS check_number_unique_per_account
  ON "check" ("companyId", "bankAccountId", "checkNumber")
  WHERE "checkNumber" IS NOT NULL;

-- ============================================================================
-- ONE ACTIVE CHECK PER PAYMENT
-- Uniqueness here is the OPPOSITE of check_number_unique_per_account above,
-- and deliberately so: a check NUMBER stays spent forever once printed
-- (misprint or not), but a PAYMENT may legitimately go through several check
-- rows over its life — one voided for every misprint, plus the one that
-- finally lands. The reprint flow (ChecksService.confirmBatch) keeps every
-- voided row as the audit trail of burned numbers and inserts a fresh queued
-- row for the same payment, so at any moment a payment must have at most one
-- NON-voided check. This index excludes voided rows on purpose — do not
-- "fix" it to match the absolute uniqueness above, and do not remove the
-- exclusion above to match this one. They encode different invariants.
-- "check" is a SQL reserved word and must stay quoted.
-- ============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS check_one_active_per_payment
  ON "check" ("paymentId")
  WHERE status <> 'voided';

-- 2. DML grant for the app role ---------------------------------------------
-- Guarded so this file can be applied before openbooks_app exists (e.g. in a
-- fresh install where create-app-role.sql hasn't run yet) without erroring.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openbooks_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "check" TO openbooks_app;
  END IF;
END $$;
