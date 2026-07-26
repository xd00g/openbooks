import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { AccountResolverService } from '../accounts/account-resolver.service';
import { IncExpRow, buildClosingEntry } from './period-close.logic';

/**
 * Period close: posts a closing entry that rolls income/expense into Retained
 * Earnings, then records the close date on the company so the period locks.
 */
@Injectable()
export class PeriodCloseService {
  private readonly log = new Logger(PeriodCloseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly accounts: AccountResolverService,
  ) {}

  async close(companyId: string, asOf: string, createdById?: string) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const company = await tx.company.findUnique({
        where: { id: companyId },
        select: { settings: true },
      });
      const settings = (company?.settings as Prisma.JsonObject) ?? {};
      const closedThrough = settings['closedThrough'] as string | undefined;
      if (closedThrough && new Date(asOf) <= new Date(closedThrough)) {
        throw new BadRequestException(
          `Period already closed through ${closedThrough}.`,
        );
      }

      // Aggregate income/expense net balances between the last close and asOf.
      const rows = await this.incomeExpenseActivity(
        tx,
        companyId,
        asOf,
        closedThrough,
      );

      const re = await this.accounts.bySubtype(
        tx,
        companyId,
        'retained_earnings',
      );
      const closing = buildClosingEntry(rows, re.id, asOf);

      let entryId: string | null = null;
      if (closing.lines.length > 0) {
        entryId = await this.ledger.createPostedEntry(tx, {
          companyId,
          entryDate: asOf,
          sourceType: 'manual',
          memo: `Period close ${asOf}`,
          createdById,
          lines: closing.lines,
        });
      }

      // Lock the period.
      await tx.company.update({
        where: { id: companyId },
        data: {
          settings: {
            ...settings,
            closedThrough: asOf,
          } as Prisma.InputJsonValue,
        },
      });

      this.log.log(
        `Closed ${companyId} through ${asOf}: net income ${closing.netIncome}, ` +
          `${closing.closedAccounts} accounts closed.`,
      );

      return {
        closedThrough: asOf,
        netIncome: closing.netIncome,
        closedAccounts: closing.closedAccounts,
        entryId,
      };
    });
  }

  /** Admin: move the closed-through date (e.g. reopen a period). */
  async setClosedThrough(companyId: string, date: string | null) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const company = await tx.company.findUnique({
        where: { id: companyId },
        select: { settings: true },
      });
      const settings = (company?.settings as Prisma.JsonObject) ?? {};
      if (date) settings['closedThrough'] = date;
      else delete settings['closedThrough'];
      await tx.company.update({
        where: { id: companyId },
        data: { settings: settings as Prisma.InputJsonValue },
      });
      return { closedThrough: date };
    });
  }

  private async incomeExpenseActivity(
    tx: PrismaClient,
    companyId: string,
    asOf: string,
    from?: string,
  ): Promise<IncExpRow[]> {
    const fromClause = from
      ? Prisma.sql`AND je.entry_date > ${from}::date`
      : Prisma.empty;

    return tx.$queryRaw<IncExpRow[]>(Prisma.sql`
      SELECT a.id            AS "accountId",
             a.code          AS code,
             a.name          AS name,
             a.type::text    AS type,
             COALESCE(SUM(jl.debit), 0)::text  AS debit,
             COALESCE(SUM(jl.credit), 0)::text AS credit
      FROM account a
      JOIN journal_line jl  ON jl.account_id = a.id
      JOIN journal_entry je ON je.id = jl.journal_entry_id
      WHERE a.company_id = ${companyId}::uuid
        AND a.type IN ('income', 'expense')
        AND je.status = 'posted'
        AND je.entry_date <= ${asOf}::date
        ${fromClause}
      GROUP BY a.id, a.code, a.name, a.type
      HAVING COALESCE(SUM(jl.debit), 0) <> COALESCE(SUM(jl.credit), 0)
      ORDER BY a.code
    `);
  }
}
