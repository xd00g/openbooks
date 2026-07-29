-- ============================================================================
-- 0003 — Expanded contact info for customers & vendors
-- Idempotent DDL. Safe to run on a live database.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 0003_contact_fields.sql
-- New columns are on already-RLS'd tables; the existing table-level DML grant
-- to the app role covers them automatically.
-- ============================================================================

ALTER TABLE customer
  ADD COLUMN IF NOT EXISTS "contactName"     text,
  ADD COLUMN IF NOT EXISTS "mobile"          text,
  ADD COLUMN IF NOT EXISTS "fax"             text,
  ADD COLUMN IF NOT EXISTS "website"         text,
  ADD COLUMN IF NOT EXISTS "shippingAddress" jsonb;

ALTER TABLE vendor
  ADD COLUMN IF NOT EXISTS "contactName" text,
  ADD COLUMN IF NOT EXISTS "mobile"      text,
  ADD COLUMN IF NOT EXISTS "fax"         text,
  ADD COLUMN IF NOT EXISTS "website"     text;
