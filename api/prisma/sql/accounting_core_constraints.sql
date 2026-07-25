-- ============================================================================
-- OpenBooks — DB-level guarantees that Prisma cannot express
-- Run as a manual migration AFTER `prisma migrate` creates the tables.
-- Target: PostgreSQL 16+
--
-- Contents:
--   1. Ledger invariants   — debit/credit shape + SUM(debit)=SUM(credit)  (doc §5.1)
--   2. Immutability guard  — block edits/deletes of POSTED journal entries  (doc §5.1)
--   3. Row-Level Security  — tenant isolation by company_id                 (doc §4.2)
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. LEDGER INVARIANTS
-- ----------------------------------------------------------------------------

-- 1a. Each line has exactly one side populated, and no negatives.
ALTER TABLE journal_line
  ADD CONSTRAINT journal_line_one_side_only
  CHECK (
    debit >= 0 AND credit >= 0
    AND (debit = 0) <> (credit = 0)   -- exactly one of the two is non-zero
  );

-- 1b. A journal entry must balance: SUM(debit) = SUM(credit).
-- Implemented as a DEFERRED constraint trigger so multi-line inserts within a
-- transaction are validated at COMMIT, not after each row.
CREATE OR REPLACE FUNCTION assert_entry_balanced()
RETURNS trigger AS $$
DECLARE
  v_entry uuid;
  v_debit numeric(19,4);
  v_credit numeric(19,4);
  v_status text;
BEGIN
  v_entry := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);

  SELECT status INTO v_status FROM journal_entry WHERE id = v_entry;

  -- Only enforce balance once an entry is posted (drafts may be lopsided).
  IF v_status IS DISTINCT FROM 'posted' THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0)
    INTO v_debit, v_credit
  FROM journal_line
  WHERE journal_entry_id = v_entry;

  IF v_debit <> v_credit THEN
    RAISE EXCEPTION
      'Journal entry % is unbalanced: debit=% credit=%',
      v_entry, v_debit, v_credit
      USING ERRCODE = 'check_violation';
  END IF;

  -- Reject empty posted entries.
  IF v_debit = 0 AND v_credit = 0 THEN
    RAISE EXCEPTION 'Posted journal entry % has no lines', v_entry
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_journal_line_balanced
  AFTER INSERT OR UPDATE OR DELETE ON journal_line
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_entry_balanced();

-- Also validate when an entry flips to 'posted'.
CREATE OR REPLACE FUNCTION assert_entry_balanced_on_post()
RETURNS trigger AS $$
DECLARE
  v_debit numeric(19,4);
  v_credit numeric(19,4);
BEGIN
  IF NEW.status = 'posted' AND OLD.status IS DISTINCT FROM 'posted' THEN
    SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0)
      INTO v_debit, v_credit
    FROM journal_line WHERE journal_entry_id = NEW.id;

    IF v_debit <> v_credit OR (v_debit = 0 AND v_credit = 0) THEN
      RAISE EXCEPTION
        'Cannot post entry %: unbalanced (debit=% credit=%)',
        NEW.id, v_debit, v_credit
        USING ERRCODE = 'check_violation';
    END IF;

    -- Stamp posted_at automatically.
    NEW.posted_at := COALESCE(NEW.posted_at, now());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_journal_entry_post_check
  BEFORE UPDATE ON journal_entry
  FOR EACH ROW EXECUTE FUNCTION assert_entry_balanced_on_post();


-- ----------------------------------------------------------------------------
-- 2. IMMUTABILITY OF POSTED ENTRIES (doc §5.1)
-- Posted entries cannot be edited or deleted; the only allowed transition is
-- posted -> void (which should itself be paired with a reversing entry in app
-- logic). Corrections are made by reversing, never by editing history.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION guard_posted_entry_immutable()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'posted' THEN
      RAISE EXCEPTION 'Posted journal entry % cannot be deleted; reverse it instead', OLD.id
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'posted' THEN
    -- Allow only the status change to 'void'; everything else is frozen.
    IF NEW.status = 'void' AND
       NEW.company_id  = OLD.company_id  AND
       NEW.entry_date  = OLD.entry_date  AND
       NEW.currency    = OLD.currency    AND
       NEW.source_type = OLD.source_type THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Posted journal entry % is immutable (only void is allowed)', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_journal_entry_immutable
  BEFORE UPDATE OR DELETE ON journal_entry
  FOR EACH ROW EXECUTE FUNCTION guard_posted_entry_immutable();

-- Freeze the lines of a posted entry as well.
CREATE OR REPLACE FUNCTION guard_posted_line_immutable()
RETURNS trigger AS $$
DECLARE
  v_status text;
  v_entry uuid;
BEGIN
  v_entry := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
  SELECT status INTO v_status FROM journal_entry WHERE id = v_entry;
  IF v_status = 'posted' THEN
    RAISE EXCEPTION 'Lines of posted entry % are immutable', v_entry
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_journal_line_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON journal_line
  FOR EACH ROW EXECUTE FUNCTION guard_posted_line_immutable();


-- ----------------------------------------------------------------------------
-- 3. ROW-LEVEL SECURITY — tenant isolation (doc §4.2)
-- The app sets, per request/connection:   SET app.current_company = '<uuid>';
-- Every tenant-scoped table then transparently filters to that company.
--
-- IMPORTANT: create a dedicated application DB role that is NOT superuser and
-- does NOT have BYPASSRLS. Superusers and table owners bypass RLS by default.
--   CREATE ROLE openbooks_app LOGIN PASSWORD '...' NOSUPERUSER;
--   ALTER TABLE ... OWNER TO some_migration_role;  -- not openbooks_app
--   FORCE ROW LEVEL SECURITY also applies the policy to the table owner.
-- ----------------------------------------------------------------------------

-- Helper: read the current company from the session GUC (NULL if unset).
CREATE OR REPLACE FUNCTION current_company_id()
RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.current_company', true), '')::uuid;
$$ LANGUAGE sql STABLE;

-- Apply the same policy shape to every company-scoped table.
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'company',            -- filtered by id, handled specially below
    'membership',
    'account',
    'journal_entry',
    'journal_line',
    'customer',
    'invoice',
    'invoice_line',
    'invoice_tax_line',
    'vendor',
    'bill',
    'bill_line',
    'payment',
    'payment_application',
    'item',
    'tax_agency',
    'tax_rate',
    'bank_account',
    'bank_transaction',
    'reconciliation',
    'employee',
    'payroll_run',
    'payroll_line',
    'attachment',
    'audit_log'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);

    IF t = 'company' THEN
      -- The company table isolates on its own primary key.
      EXECUTE format($f$
        CREATE POLICY tenant_isolation ON %I
          USING (id = current_company_id())
          WITH CHECK (id = current_company_id());
      $f$, t);
    ELSE
      EXECUTE format($f$
        CREATE POLICY tenant_isolation ON %I
          USING (company_id = current_company_id())
          WITH CHECK (company_id = current_company_id());
      $f$, t);
    END IF;
  END LOOP;
END $$;

-- Notes:
--  * organization, app_user, and role are cross-tenant by design and are NOT
--    under company RLS; guard them in the application layer (a user's visible
--    orgs/companies come from their memberships).
--  * Grant the app role only DML on these tables; run migrations as a separate
--    owner role so FORCE RLS still protects the owner path.
