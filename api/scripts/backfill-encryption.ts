/**
 * One-time (idempotent) backfill: encrypt secrets that were written before
 * field-level encryption was enabled. Safe to re-run — already-encrypted values
 * are skipped. Decryption tolerates plaintext, so running this is optional for
 * correctness but recommended so nothing sensitive stays in the clear.
 *
 *   FIELD_ENCRYPTION_KEY=... ADMIN_DATABASE_URL=... npm run backfill:encryption
 *
 * Runs on the admin (RLS-bypassing) connection so it can sweep every tenant.
 */
import { PrismaClient } from '@prisma/client';
import {
  encryptWith,
  isEncrypted,
  loadKey,
} from '../src/common/crypto/field-crypto';

async function main() {
  const key = loadKey(process.env.FIELD_ENCRYPTION_KEY);
  if (!key) {
    console.error('FIELD_ENCRYPTION_KEY is required to run the backfill.');
    process.exit(1);
  }
  const prisma = new PrismaClient({
    datasources: {
      db: { url: process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL },
    },
  });

  let updated = 0;

  // 1. Bank access tokens.
  const banks = await prisma.bankAccount.findMany({
    select: { id: true, accessToken: true },
  });
  for (const b of banks) {
    if (b.accessToken && !isEncrypted(b.accessToken)) {
      await prisma.bankAccount.update({
        where: { id: b.id },
        data: { accessToken: encryptWith(key, b.accessToken) },
      });
      updated++;
    }
  }

  // 2. Company EIN + stored SimpleFIN access URL.
  const companies = await prisma.company.findMany({
    select: { id: true, ein: true, settings: true },
  });
  for (const c of companies) {
    const data: Record<string, unknown> = {};
    if (c.ein && !isEncrypted(c.ein)) data.ein = encryptWith(key, c.ein);
    const s = { ...((c.settings as Record<string, unknown>) ?? {}) };
    const url = s.simplefinAccessUrl;
    if (typeof url === 'string' && url && !isEncrypted(url)) {
      s.simplefinAccessUrl = encryptWith(key, url);
      data.settings = s;
    }
    if (Object.keys(data).length) {
      await prisma.company.update({ where: { id: c.id }, data: data as never });
      updated++;
    }
  }

  // 3. System settings secrets.
  const secretField: Record<string, string> = {
    oidc: 'clientSecret',
    saml: 'cert',
    smtp: 'password',
  };
  const rows = await prisma.systemSetting.findMany();
  for (const r of rows) {
    const field = secretField[r.key];
    if (!field) continue;
    const v = { ...((r.value as Record<string, unknown>) ?? {}) };
    const cur = v[field];
    if (typeof cur === 'string' && cur && !isEncrypted(cur)) {
      v[field] = encryptWith(key, cur);
      await prisma.systemSetting.update({
        where: { key: r.key },
        data: { value: v as never },
      });
      updated++;
    }
  }

  console.log(`Encryption backfill complete. Updated ${updated} record(s).`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
