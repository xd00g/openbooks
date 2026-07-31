/**
 * Integration test: exercises the REAL accounting_core_constraints.sql against
 * a live PostgreSQL. Self-contained — boots its own Postgres via
 * embedded-postgres, so it runs locally and in CI with no external service:
 *
 *     npm run test:int
 *
 * It validates the guarantees Prisma cannot express (and that unit tests can't
 * reach): the balance/immutability triggers, the closed-period guard, and
 * Row-Level Security tenant isolation. Table names/columns here mirror the
 * Prisma output (snake_case tables, camelCase columns).
 */
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';

const here = dirname(fileURLToPath(import.meta.url));
const harnessSql = readFileSync(resolve(here, '../db-guarantees.harness.sql'), 'utf8');
const constraintsSql = readFileSync(
  resolve(here, '../../prisma/sql/accounting_core_constraints.sql'),
  'utf8',
);

let pass = 0, fail = 0;
const ok = (n, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`); c ? pass++ : fail++; };
async function expectErr(client, sql, params, re) {
  try { await client.query(sql, params); return false; }
  catch (e) { return re ? re.test(e.message) : true; }
}
const conn = (port, database) =>
  new pg.Client({ host: 'localhost', port, user: 'postgres', password: 'postgres', database });

async function main() {
  const port = 5400 + Math.floor(Math.random() * 150);
  const epg = new EmbeddedPostgres({
    databaseDir: mkdtempSync(resolve(tmpdir(), 'ob-pg-')),
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
  });
  await epg.initialise();
  await epg.start();
  await epg.createDatabase('openbooks');

  const c = conn(port, 'openbooks');
  await c.connect();

  await c.query(harnessSql);
  await c.query(constraintsSql);
  ok('constraints file applies to real Postgres', true);

  await c.query(`CREATE ROLE openbooks_app NOSUPERUSER`);
  await c.query(`GRANT USAGE ON SCHEMA public TO openbooks_app`);
  await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO openbooks_app`);

  const A = (await c.query(`INSERT INTO company DEFAULT VALUES RETURNING id`)).rows[0].id;
  const B = (await c.query(`INSERT INTO company DEFAULT VALUES RETURNING id`)).rows[0].id;
  const acctA = (await c.query(`INSERT INTO account("companyId",code,name,type,subtype) VALUES($1,'1010','Cash','asset','bank') RETURNING id`, [A])).rows[0].id;
  const acctA2 = (await c.query(`INSERT INTO account("companyId",code,name,type,subtype) VALUES($1,'4000','Sales','income','income') RETURNING id`, [A])).rows[0].id;

  const postBalanced = async (company, aId, bId, d) => {
    const e = (await c.query(`INSERT INTO journal_entry("companyId","entryDate") VALUES($1,$2) RETURNING id`, [company, d])).rows[0].id;
    await c.query(`INSERT INTO journal_line("companyId","journalEntryId","accountId",debit,credit) VALUES($1,$2,$3,100,0)`, [company, e, aId]);
    await c.query(`INSERT INTO journal_line("companyId","journalEntryId","accountId",debit,credit) VALUES($1,$2,$3,0,100)`, [company, e, bId]);
    await c.query(`UPDATE journal_entry SET status='posted' WHERE id=$1`, [e]);
    return e;
  };

  // 1a. one-sided CHECK
  const eDraft = (await c.query(`INSERT INTO journal_entry("companyId","entryDate") VALUES($1,'2026-07-15') RETURNING id`, [A])).rows[0].id;
  ok('CHECK rejects a two-sided line', await expectErr(c,
    `INSERT INTO journal_line("companyId","journalEntryId","accountId",debit,credit) VALUES($1,$2,$3,100,100)`, [A, eDraft, acctA]));

  // 1b. balance on post
  await c.query(`INSERT INTO journal_line("companyId","journalEntryId","accountId",debit,credit) VALUES($1,$2,$3,100,0)`, [A, eDraft, acctA]);
  ok('cannot POST an unbalanced entry', await expectErr(c,
    `UPDATE journal_entry SET status='posted' WHERE id=$1`, [eDraft], /unbalanced/i));
  await c.query(`INSERT INTO journal_line("companyId","journalEntryId","accountId",debit,credit) VALUES($1,$2,$3,0,100)`, [A, eDraft, acctA2]);
  await c.query(`UPDATE journal_entry SET status='posted' WHERE id=$1`, [eDraft]);
  const posted = (await c.query(`SELECT status,"postedAt" FROM journal_entry WHERE id=$1`, [eDraft])).rows[0];
  ok('balanced entry posts and stamps postedAt', posted.status === 'posted' && posted.postedAt != null);

  // 2. immutability
  ok('posted entry cannot be edited', await expectErr(c, `UPDATE journal_entry SET memo='x' WHERE id=$1`, [eDraft], /immutable/i));
  ok('posted entry cannot be deleted', await expectErr(c, `DELETE FROM journal_entry WHERE id=$1`, [eDraft], /cannot be deleted/i));
  ok('posted lines cannot be edited', await expectErr(c, `UPDATE journal_line SET memo='y' WHERE "journalEntryId"=$1`, [eDraft], /immutable/i));
  await c.query(`UPDATE journal_entry SET status='void' WHERE id=$1`, [eDraft]);
  ok('posted -> void transition allowed', (await c.query(`SELECT status FROM journal_entry WHERE id=$1`, [eDraft])).rows[0].status === 'void');

  // 4. closed-period
  await c.query(`UPDATE company SET settings='{"closedThrough":"2026-06-30"}' WHERE id=$1`, [A]);
  ok('cannot post into a closed period', await expectErr(c,
    `INSERT INTO journal_entry("companyId","entryDate") VALUES($1,'2026-06-15')`, [A], /closed through/i));
  ok('can post after the close date',
    (await c.query(`INSERT INTO journal_entry("companyId","entryDate") VALUES($1,'2026-07-15') RETURNING id`, [A])).rows.length === 1);
  await c.query(`UPDATE company SET settings='{}' WHERE id=$1`, [A]);

  // 3. RLS isolation
  await postBalanced(A, acctA, acctA2, '2026-07-16');
  await postBalanced(A, acctA, acctA2, '2026-07-17');
  const acctB = (await c.query(`INSERT INTO account("companyId",code,name,type,subtype) VALUES($1,'1010','Cash','asset','bank') RETURNING id`, [B])).rows[0].id;
  const acctB2 = (await c.query(`INSERT INTO account("companyId",code,name,type,subtype) VALUES($1,'4000','Sales','income','income') RETURNING id`, [B])).rows[0].id;
  await postBalanced(B, acctB, acctB2, '2026-07-16');

  const countAs = async (company) => {
    const cli = conn(port, 'openbooks');
    await cli.connect();
    await cli.query('SET ROLE openbooks_app');
    await cli.query("SELECT set_config('app.current_company', $1, false)", [company]);
    const entries = (await cli.query('SELECT count(*)::int AS n FROM journal_entry')).rows[0].n;
    const accounts = (await cli.query('SELECT count(*)::int AS n FROM account')).rows[0].n;
    await cli.end();
    return { entries, accounts };
  };
  const a = await countAs(A);
  const b = await countAs(B);
  ok(`RLS: company A sees only its rows, not B's (entries=${a.entries})`, a.entries === 4 && a.accounts === 2);
  ok(`RLS: company B sees only its rows (entries=${b.entries})`, b.entries === 1 && b.accounts === 2);

  const cli = conn(port, 'openbooks');
  await cli.connect();
  await cli.query('SET ROLE openbooks_app');
  await cli.query("SELECT set_config('app.current_company', $1, false)", [A]);
  ok('RLS: app role cannot INSERT a row for another company',
    await expectErr(cli, `INSERT INTO account("companyId",code,name,type,subtype) VALUES($1,'9','x','asset','bank')`, [B], /row-level security|policy/i));
  await cli.end();

  // ==========================================================================
  // CHECK NUMBERING GUARANTEES (Task 8)
  // Exercises the two partial unique indexes added to
  // accounting_core_constraints.sql: check_number_unique_per_account (absolute,
  // ignores voided) and check_one_active_per_payment (excludes voided).
  // ==========================================================================
  const bankAcctA = (await c.query(`INSERT INTO bank_account("companyId") VALUES($1) RETURNING id`, [A])).rows[0].id;
  const bankAcctA2 = (await c.query(`INSERT INTO bank_account("companyId") VALUES($1) RETURNING id`, [A])).rows[0].id;
  const bankAcctB = (await c.query(`INSERT INTO bank_account("companyId") VALUES($1) RETURNING id`, [B])).rows[0].id;

  const payment1 = (await c.query(`INSERT INTO payment("companyId") VALUES($1) RETURNING id`, [A])).rows[0].id;
  const payment2 = (await c.query(`INSERT INTO payment("companyId") VALUES($1) RETURNING id`, [A])).rows[0].id;
  const paymentB = (await c.query(`INSERT INTO payment("companyId") VALUES($1) RETURNING id`, [B])).rows[0].id;

  // 1. A second live check with the same (companyId, bankAccountId, checkNumber) is rejected.
  const check1 = (await c.query(
    `INSERT INTO "check"("companyId","bankAccountId","paymentId","checkNumber",status) VALUES($1,$2,$3,1001,'printed') RETURNING id`,
    [A, bankAcctA, payment1],
  )).rows[0].id;
  ok('check_number_unique_per_account rejects a second live check with the same number/account',
    await expectErr(c,
      `INSERT INTO "check"("companyId","bankAccountId","paymentId","checkNumber",status) VALUES($1,$2,$3,1001,'printed')`,
      [A, bankAcctA, payment2]));

  // 2. After voiding the first, reusing that number is STILL rejected — a printed
  // number is spent forever, regardless of what happened to the paper.
  await c.query(`UPDATE "check" SET status='voided' WHERE id=$1`, [check1]);
  ok('check_number_unique_per_account still rejects reuse of a voided check\'s number',
    await expectErr(c,
      `INSERT INTO "check"("companyId","bankAccountId","paymentId","checkNumber",status) VALUES($1,$2,$3,1001,'printed')`,
      [A, bankAcctA, payment2]));

  // 3. The same number on a DIFFERENT bankAccountId is allowed.
  ok('check_number_unique_per_account allows the same number on a different bank account',
    (await c.query(
      `INSERT INTO "check"("companyId","bankAccountId","paymentId","checkNumber",status) VALUES($1,$2,$3,1001,'printed') RETURNING id`,
      [A, bankAcctA2, payment2],
    )).rows.length === 1);

  // 4. A NULL checkNumber does not collide — two queued checks with no number coexist.
  // Use fresh payments so this doesn't trip check_one_active_per_payment, which
  // is a separate invariant under test elsewhere.
  const paymentNull1 = (await c.query(`INSERT INTO payment("companyId") VALUES($1) RETURNING id`, [A])).rows[0].id;
  const paymentNull2 = (await c.query(`INSERT INTO payment("companyId") VALUES($1) RETURNING id`, [A])).rows[0].id;
  ok('check_number_unique_per_account does not apply to NULL checkNumbers',
    (await c.query(
      `INSERT INTO "check"("companyId","bankAccountId","paymentId",status) VALUES($1,$2,$3,'queued'), ($1,$2,$4,'queued') RETURNING id`,
      [A, bankAcctA, paymentNull1, paymentNull2],
    )).rows.length === 2);

  // 5. Two non-voided checks for the same paymentId are rejected.
  const paymentActive = (await c.query(`INSERT INTO payment("companyId") VALUES($1) RETURNING id`, [A])).rows[0].id;
  const checkActive1 = (await c.query(
    `INSERT INTO "check"("companyId","bankAccountId","paymentId","checkNumber",status) VALUES($1,$2,$3,2001,'printed') RETURNING id`,
    [A, bankAcctA, paymentActive],
  )).rows[0].id;
  ok('check_one_active_per_payment rejects a second non-voided check for the same payment',
    await expectErr(c,
      `INSERT INTO "check"("companyId","bankAccountId","paymentId","checkNumber",status) VALUES($1,$2,$3,2002,'printed')`,
      [A, bankAcctA, paymentActive]));

  // 6. After voiding the first, a new active check for that payment is allowed
  // (the misprint-reprint path).
  await c.query(`UPDATE "check" SET status='voided' WHERE id=$1`, [checkActive1]);
  ok('check_one_active_per_payment allows a reprint after the prior check is voided',
    (await c.query(
      `INSERT INTO "check"("companyId","bankAccountId","paymentId","checkNumber",status) VALUES($1,$2,$3,2002,'printed') RETURNING id`,
      [A, bankAcctA, paymentActive],
    )).rows.length === 1);

  // 7. RLS: company B cannot see company A's checks.
  //
  // NOTE: as of this writing this assertion FAILS against the real
  // accounting_core_constraints.sql. The RLS enablement loop in that file
  // (~line 193) enrolls tables from a hardcoded `tenant_tables` array, and
  // "check" was never added to it when Task 3 added the check table/indexes.
  // Confirmed directly: `SELECT relrowsecurity FROM pg_class WHERE relname =
  // 'check'` returns false after applying the constraints file to a fresh DB.
  // This is a genuine, previously-undetected gap in production code: check
  // rows are NOT tenant-isolated at the database level. Fixing it requires
  // adding 'check' to the tenant_tables array in accounting_core_constraints.sql,
  // which this task explicitly forbids modifying. The assertion is left as
  // written (expressing the guarantee that SHOULD hold) rather than weakened
  // to match current behavior, so it continues to fail loudly until that
  // one-line fix lands. See task-8-report.md for details.
  await c.query(
    `INSERT INTO "check"("companyId","bankAccountId","paymentId","checkNumber",status) VALUES($1,$2,$3,1,'printed')`,
    [B, bankAcctB, paymentB],
  );
  const checksAsB = await conn(port, 'openbooks');
  await checksAsB.connect();
  await checksAsB.query('SET ROLE openbooks_app');
  await checksAsB.query("SELECT set_config('app.current_company', $1, false)", [B]);
  const bChecksOfA = (await checksAsB.query(`SELECT count(*)::int AS n FROM "check" WHERE "companyId" = $1`, [A])).rows[0].n;
  await checksAsB.end();
  ok('RLS: company B cannot see company A\'s checks', bChecksOfA === 0);

  await c.end();
  await epg.stop();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
