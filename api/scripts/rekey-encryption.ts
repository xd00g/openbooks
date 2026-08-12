/**
 * Re-encrypt every field-level secret under the active key.
 *
 * Step 5 of the rotation procedure in docs/KEY-MANAGEMENT.md. Also upgrades
 * legacy `enc:v1:` values to `enc:v2:` and encrypts any plaintext left over from
 * before encryption was enabled, so it supersedes backfill-encryption.ts.
 *
 *   # report only — writes nothing
 *   FIELD_ENCRYPTION_KEYS=... FIELD_ENCRYPTION_ACTIVE_KEY_ID=... \
 *   ADMIN_DATABASE_URL=... npm run rekey:encryption
 *
 *   # actually write
 *   ... npm run rekey:encryption -- --apply
 *
 * Dry run is the default deliberately: it proves every stored value is readable
 * with the configured keyring BEFORE anything is modified. Run it first. If it
 * reports even one unreadable value, do not apply — you are missing a key, and
 * writing would strand that row further.
 *
 * Properties that matter:
 *  - Idempotent and resumable. Values already under the active key are skipped,
 *    so an interrupted run is safe to repeat.
 *  - Row-at-a-time writes, not one large transaction. A long-running
 *    transaction against a live database is worse than a slow job.
 *  - Never writes a value it could not decrypt. A failure is logged and the run
 *    continues; one unreadable row must not abort the pass or, far worse, get
 *    overwritten with garbage.
 *  - Runs on the admin (RLS-bypassing) connection so it spans every tenant.
 */
import { PrismaClient } from '@prisma/client';
import { EncryptionService } from '../src/common/crypto/encryption.service';
import { isEncrypted, keyIdOf } from '../src/common/crypto/field-crypto';

const APPLY = process.argv.includes('--apply');

interface Stats {
  scanned: number;
  rekeyed: number;
  alreadyCurrent: number;
  plaintext: number;
  failed: number;
}
const stats: Stats = { scanned: 0, rekeyed: 0, alreadyCurrent: 0, plaintext: 0, failed: 0 };

/** Key id -> count, so you can prove no value still needs a key before retiring it. */
const byKeyId = new Map<string, number>();
const failures: string[] = [];

/**
 * Decide what a single value needs. Returns the replacement, or null to skip.
 * Records the audit tally as a side effect.
 */
function plan(enc: EncryptionService, where: string, value: string): string | null {
  stats.scanned++;

  if (!isEncrypted(value)) {
    stats.plaintext++;
    byKeyId.set('(plaintext)', (byKeyId.get('(plaintext)') ?? 0) + 1);
  } else {
    let id: string;
    try {
      id = keyIdOf(value);
    } catch (e) {
      stats.failed++;
      failures.push(`${where}: unparseable ciphertext — ${(e as Error).message}`);
      return null;
    }
    byKeyId.set(id, (byKeyId.get(id) ?? 0) + 1);
  }

  try {
    const next = enc.rekey(value);
    if (next === null) {
      stats.alreadyCurrent++;
      return null;
    }
    stats.rekeyed++;
    return next;
  } catch (e) {
    stats.failed++;
    failures.push(`${where}: ${(e as Error).message}`);
    return null;
  }
}

async function main() {
  // Constructing the service validates the keyring and fails fast if it is
  // missing or ambiguous — before we touch a single row.
  const enc = new EncryptionService();
  if (!enc.enabled) {
    console.error(
      'Encryption is in plaintext passthrough mode (ALLOW_PLAINTEXT_SECRETS=true). ' +
        'Configure a keyring before rekeying.',
    );
    process.exit(1);
  }

  console.log(`Active key: ${enc.activeKeyId}`);
  console.log(APPLY ? 'Mode: APPLY (writing)\n' : 'Mode: DRY RUN (no writes) — pass --apply to write\n');

  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL } },
  });

  // 1. Bank access tokens.
  for (const b of await prisma.bankAccount.findMany({ select: { id: true, accessToken: true } })) {
    if (!b.accessToken) continue;
    const next = plan(enc, `bankAccount:${b.id}.accessToken`, b.accessToken);
    if (next && APPLY) {
      await prisma.bankAccount.update({ where: { id: b.id }, data: { accessToken: next } });
    }
  }

  // 2. Company EIN, plus the SimpleFIN access URL nested in settings JSON.
  for (const c of await prisma.company.findMany({ select: { id: true, ein: true, settings: true } })) {
    const data: Record<string, unknown> = {};

    if (c.ein) {
      const next = plan(enc, `company:${c.id}.ein`, c.ein);
      if (next) data.ein = next;
    }

    const s = { ...((c.settings as Record<string, unknown>) ?? {}) };
    const url = s.simplefinAccessUrl;
    if (typeof url === 'string' && url) {
      const next = plan(enc, `company:${c.id}.settings.simplefinAccessUrl`, url);
      if (next) {
        s.simplefinAccessUrl = next;
        data.settings = s;
      }
    }

    if (Object.keys(data).length && APPLY) {
      await prisma.company.update({ where: { id: c.id }, data: data as never });
    }
  }

  // 3. Vendor tax IDs. NOTE: backfill-encryption.ts never covered these.
  for (const v of await prisma.vendor.findMany({ select: { id: true, taxId: true } })) {
    if (!v.taxId) continue;
    const next = plan(enc, `vendor:${v.id}.taxId`, v.taxId);
    if (next && APPLY) {
      await prisma.vendor.update({ where: { id: v.id }, data: { taxId: next } });
    }
  }

  // 4. Employee SSN + direct-deposit account. Also absent from the old backfill.
  for (const e of await prisma.employee.findMany({
    select: { id: true, ssnEncrypted: true, bankAccountEncrypted: true },
  })) {
    const data: Record<string, unknown> = {};
    if (e.ssnEncrypted) {
      const next = plan(enc, `employee:${e.id}.ssnEncrypted`, e.ssnEncrypted);
      if (next) data.ssnEncrypted = next;
    }
    if (e.bankAccountEncrypted) {
      const next = plan(enc, `employee:${e.id}.bankAccountEncrypted`, e.bankAccountEncrypted);
      if (next) data.bankAccountEncrypted = next;
    }
    if (Object.keys(data).length && APPLY) {
      await prisma.employee.update({ where: { id: e.id }, data: data as never });
    }
  }

  // 5. System settings secrets (OIDC client secret, SAML cert, SMTP password).
  const secretField: Record<string, string> = {
    oidc: 'clientSecret',
    saml: 'cert',
    smtp: 'password',
  };
  for (const r of await prisma.systemSetting.findMany()) {
    const field = secretField[r.key];
    if (!field) continue;
    const v = { ...((r.value as Record<string, unknown>) ?? {}) };
    const cur = v[field];
    if (typeof cur !== 'string' || !cur) continue;

    const next = plan(enc, `systemSetting:${r.key}.${field}`, cur);
    if (next && APPLY) {
      v[field] = next;
      await prisma.systemSetting.update({ where: { key: r.key }, data: { value: v as never } });
    }
  }

  await prisma.$disconnect();

  console.log('Values found, by key id:');
  for (const [id, n] of [...byKeyId.entries()].sort()) {
    const marker = id === enc.activeKeyId ? '  (active)' : '';
    console.log(`  ${id.padEnd(16)} ${String(n).padStart(6)}${marker}`);
  }

  console.log(
    `\nscanned=${stats.scanned} ${APPLY ? 'rekeyed' : 'would rekey'}=${stats.rekeyed} ` +
      `already-current=${stats.alreadyCurrent} plaintext=${stats.plaintext} failed=${stats.failed}`,
  );

  if (failures.length) {
    console.error(`\n${failures.length} value(s) could not be processed:`);
    for (const f of failures.slice(0, 50)) console.error(`  ${f}`);
    if (failures.length > 50) console.error(`  … and ${failures.length - 50} more`);
    console.error(
      '\nA missing key id above means a key was retired too early — restore it to the ' +
        'keyring before applying. Nothing was written for these rows.',
    );
    process.exit(2);
  }

  if (!APPLY && stats.rekeyed > 0) {
    console.log('\nDry run clean. Re-run with --apply to write.');
  }
  if (APPLY && stats.rekeyed > 0) {
    console.log(
      '\nDone. Keep the previous key in escrow until a backup taken AFTER this run has ' +
        'been restore-tested — older backups still require it.',
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
