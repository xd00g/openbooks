-- ============================================================================
-- 0004 — Payment terms (Net 30, Due on receipt, 2/10 Net 30, ...)
-- Idempotent. Tenant-scoped table with the same RLS pattern as other tenant
-- tables (companyId = current_company_id()).
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 0004_payment_terms.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS payment_term (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "companyId"       uuid NOT NULL,
  name              text NOT NULL,
  "dueInDays"       integer NOT NULL DEFAULT 30,
  "discountPercent" numeric(9,6),
  "discountDays"    integer,
  "isActive"        boolean NOT NULL DEFAULT true,
  "createdAt"       timestamp(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_term_company_idx ON payment_term ("companyId");

ALTER TABLE payment_term ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'payment_term' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON payment_term
      USING ("companyId" = current_company_id())
      WITH CHECK ("companyId" = current_company_id());
  END IF;
END $$;

-- Grant to the non-superuser app role (in case default privileges didn't cover it).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openbooks_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON payment_term TO openbooks_app;
  END IF;
END $$;

ALTER TABLE invoice ADD COLUMN IF NOT EXISTS "paymentTermId" uuid;
ALTER TABLE bill    ADD COLUMN IF NOT EXISTS "paymentTermId" uuid;
