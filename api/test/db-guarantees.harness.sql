-- Minimal DDL that mirrors the Prisma-generated tables (snake_case table names
-- via @@map, camelCase columns) for the tables the constraints file touches.
-- Used only by the integration harness to exercise the REAL
-- accounting_core_constraints.sql against a live Postgres. Production DDL comes
-- from `prisma migrate`, not this file.

CREATE TABLE company (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settings jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "companyId" uuid NOT NULL,
  code text, name text, type text, subtype text
);

CREATE TABLE journal_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "companyId" uuid NOT NULL,
  "entryDate" date NOT NULL,
  memo text,
  "sourceType" text NOT NULL DEFAULT 'manual',
  "sourceId" uuid,
  status text NOT NULL DEFAULT 'draft',
  currency text NOT NULL DEFAULT 'USD',
  "createdById" uuid,
  "postedAt" timestamptz,
  "reversalOfId" uuid
);

CREATE TABLE journal_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "companyId" uuid NOT NULL,
  "journalEntryId" uuid NOT NULL,
  "accountId" uuid NOT NULL,
  debit numeric(19,4) NOT NULL DEFAULT 0,
  credit numeric(19,4) NOT NULL DEFAULT 0,
  memo text,
  "entityType" text,
  "entityId" uuid,
  dimensions jsonb NOT NULL DEFAULT '{}'
);

-- Remaining tenant tables the RLS DO-block enumerates (minimal shape).
CREATE TABLE membership          (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "companyId" uuid NOT NULL);
CREATE TABLE customer            (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "companyId" uuid NOT NULL);
CREATE TABLE invoice             (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "companyId" uuid NOT NULL);
CREATE TABLE invoice_line        (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "companyId" uuid NOT NULL);
CREATE TABLE invoice_tax_line    (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "companyId" uuid NOT NULL);
CREATE TABLE vendor              (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "companyId" uuid NOT NULL);
CREATE TABLE bill                (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "companyId" uuid NOT NULL);
CREATE TABLE bill_line           (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "companyId" uuid NOT NULL);
CREATE TABLE payment             (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "companyId" uuid NOT NULL);
CREATE TABLE payment_application (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "companyId" uuid NOT NULL);
CREATE TABLE item                (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "companyId" uuid NOT NULL);
CREATE TABLE tax_agency          (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "companyId" uuid NOT NULL);
CREATE TABLE tax_rate            (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "companyId" uuid NOT NULL);
CREATE TABLE bank_account        (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "companyId" uuid NOT NULL);
CREATE TABLE bank_transaction    (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "companyId" uuid NOT NULL);
CREATE TABLE reconciliation      (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "companyId" uuid NOT NULL);
CREATE TABLE employee            (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "companyId" uuid NOT NULL);
CREATE TABLE payroll_run         (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "companyId" uuid NOT NULL);
CREATE TABLE payroll_line        (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "companyId" uuid NOT NULL);
CREATE TABLE attachment          (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "companyId" uuid NOT NULL);
CREATE TABLE audit_log           (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "companyId" uuid NOT NULL);

-- "check" stub: only the columns referenced by the two partial unique indexes
-- in accounting_core_constraints.sql (check_number_unique_per_account,
-- check_one_active_per_payment). "check" is a SQL reserved word and must stay
-- quoted, same as in the constraints file.
CREATE TABLE "check" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "companyId" uuid NOT NULL,
  "bankAccountId" uuid NOT NULL,
  "paymentId" uuid NOT NULL,
  "checkNumber" integer,
  status text NOT NULL DEFAULT 'queued'
);
