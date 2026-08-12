-- ==========================================================================
-- OpenBooks — create the NON-superuser runtime role so RLS is enforced.
--
-- A superuser bypasses Row-Level Security entirely, so the running app must
-- NOT connect as the postgres/owner superuser. This creates a dedicated
-- login role for DATABASE_URL, while the superuser stays reserved for
-- migrations, the SQL constraints, and the app's onboarding/auth path
-- (ADMIN_DATABASE_URL).
--
-- Run as the superuser AFTER the schema exists (prisma migrate / db push and
-- accounting_core_constraints.sql). Change the password first, and make it
-- match the DATABASE_URL password in your .env.
-- ==========================================================================

-- Change this to a strong password that matches DATABASE_URL in .env:
\set app_password 'change-me-app'

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openbooks_app') THEN
    CREATE ROLE openbooks_app LOGIN PASSWORD :'app_password'
      NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

-- Keep the password in sync if the role already existed.
ALTER ROLE openbooks_app WITH PASSWORD :'app_password';

GRANT USAGE ON SCHEMA public TO openbooks_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO openbooks_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO openbooks_app;

-- Ensure objects created later (future migrations) are usable too.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO openbooks_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO openbooks_app;

-- Sanity: this role must NOT be able to bypass RLS.
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'openbooks_app';
