import { Injectable, NotFoundException } from '@nestjs/common';
import { AccountSubtype, PrismaClient } from '@prisma/client';

/**
 * Resolves the system/default accounts a posting needs (AR, AP, Undeposited
 * Funds, etc.) for a company. Runs on a company-scoped tx so RLS applies.
 *
 * Strategy: look up by `subtype`. A company should have exactly one active
 * account per system subtype (seeded from the CoA template). Payroll accounts
 * can be overridden per company via company.settings.payrollAccounts; this
 * resolver falls back to subtype lookups otherwise.
 */
@Injectable()
export class AccountResolverService {
  async bySubtype(
    tx: PrismaClient,
    companyId: string,
    subtype: AccountSubtype,
  ): Promise<{ id: string }> {
    const acct = await tx.account.findFirst({
      where: { companyId, subtype, isActive: true },
      select: { id: true },
      orderBy: { code: 'asc' },
    });
    if (!acct) {
      throw new NotFoundException(
        `No active account with subtype "${subtype}" for this company. ` +
          `Seed the chart of accounts first.`,
      );
    }
    return acct;
  }

  async byId(
    tx: PrismaClient,
    companyId: string,
    accountId: string,
  ): Promise<{ id: string }> {
    const acct = await tx.account.findFirst({
      where: { id: accountId, companyId, isActive: true },
      select: { id: true },
    });
    if (!acct) {
      throw new NotFoundException(`Account ${accountId} not found in company.`);
    }
    return acct;
  }
}
