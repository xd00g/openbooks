/**
 * Demo seed — bootstraps one organization + company + owner and seeds the
 * standard chart of accounts, so a fresh install has something to log into and
 * the AccountResolverService has system accounts to find.
 *
 * Run with:  npx prisma db seed
 *
 * IMPORTANT: run this with a DB role that can bypass RLS (e.g. the postgres
 * superuser), because creating the Organization/Company rows happens before any
 * `app.current_company` is set. In production, company creation is an onboarding
 * flow with its own privileged path — see docs/DESIGN.md §17.
 */
import { PrismaClient } from '@prisma/client';
import {
  STANDARD_US_SMB,
  buildPayrollAccountSettings,
} from '../src/accounts/coa-template';

const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: { id: '00000000-0000-0000-0000-000000000001', name: 'Demo Org' },
  });

  const company = await prisma.company.upsert({
    where: { id: '00000000-0000-0000-0000-0000000000c0' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-0000000000c0',
      organizationId: org.id,
      legalName: 'Acme LLC',
      baseCurrency: 'USD',
      country: 'US',
    },
  });

  const owner = await prisma.user.upsert({
    where: { email: process.env.BOOTSTRAP_ADMIN_EMAIL ?? 'admin@example.com' },
    update: {},
    create: {
      email: process.env.BOOTSTRAP_ADMIN_EMAIL ?? 'admin@example.com',
      fullName: 'Demo Admin',
      isSystemAdmin: true,
    },
  });

  const ownerRole = await prisma.role.upsert({
    where: {
      organizationId_name: { organizationId: org.id, name: 'Owner' },
    },
    update: {},
    create: {
      organizationId: org.id,
      name: 'Owner',
      isSystem: true,
      permissions: ['*'],
    },
  });

  await prisma.membership.upsert({
    where: { userId_companyId: { userId: owner.id, companyId: company.id } },
    update: {},
    create: {
      userId: owner.id,
      companyId: company.id,
      organizationId: org.id,
      roleId: ownerRole.id,
    },
  });

  // Seed the chart of accounts (mirrors CoaSeederService, standalone).
  for (const a of STANDARD_US_SMB.accounts) {
    await prisma.account.upsert({
      where: { companyId_code: { companyId: company.id, code: a.code } },
      update: { name: a.name },
      create: {
        companyId: company.id,
        code: a.code,
        name: a.name,
        type: a.type as never,
        subtype: a.subtype as never,
        isSystem: a.isSystem ?? false,
      },
    });
  }

  const rows = await prisma.account.findMany({
    where: { companyId: company.id },
    select: { id: true, code: true },
  });
  const idByCode = new Map(rows.map((r) => [r.code, r.id]));

  for (const a of STANDARD_US_SMB.accounts) {
    if (a.parentCode) {
      await prisma.account.update({
        where: { companyId_code: { companyId: company.id, code: a.code } },
        data: { parentId: idByCode.get(a.parentCode) },
      });
    }
  }

  await prisma.company.update({
    where: { id: company.id },
    data: {
      settings: { payrollAccounts: buildPayrollAccountSettings(idByCode) },
    },
  });

  // eslint-disable-next-line no-console
  console.log(
    `Seeded org "${org.name}", company "${company.legalName}", owner ${owner.email}, ` +
      `and ${rows.length} accounts.`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
