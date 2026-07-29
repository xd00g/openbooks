-- ============================================================================
-- 0002 — System settings (SSO/SMTP) + per-company branding theme
--
-- Idempotent DDL for the two features added after the initial schema. Safe to
-- run on a live database. Apply with prisma (it will pick up the schema change)
-- OR run this file directly via psql if you manage DDL by hand:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 0002_system_settings_and_theme.sql
--
-- NOTES
--  * company.theme is a new column on an already-RLS'd table — the existing
--    table-level DML grant to the app role covers it automatically.
--  * system_setting is CROSS-TENANT (like organization/app_user/role): it is
--    deliberately NOT under company row-level security, because SSO/SMTP config
--    must resolve on the pre-login path where no company is selected. The app
--    reads/writes it through the RLS-bypassing admin connection, so an app-role
--    grant is optional; one is included (commented) for completeness.
-- ============================================================================

-- 1. Per-company branding palette -------------------------------------------
ALTER TABLE company
  ADD COLUMN IF NOT EXISTS theme jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 2. Deployment-level system settings (SSO / SMTP) --------------------------
CREATE TABLE IF NOT EXISTS system_setting (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL DEFAULT '{}'::jsonb,
  "updatedAt" timestamp(3) NOT NULL DEFAULT now()
);

-- Explicitly keep system_setting OUT of row-level security. (No policy = no
-- tenant filter; access is controlled at the application layer + admin conn.)
ALTER TABLE system_setting DISABLE ROW LEVEL SECURITY;

-- Optional: if you also read system_setting on the app role rather than the
-- admin role, uncomment and set your app role name:
--   GRANT SELECT, INSERT, UPDATE, DELETE ON system_setting TO openbooks_app;
