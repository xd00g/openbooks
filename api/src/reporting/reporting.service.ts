import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildBalanceSheet,
  buildIncomeStatement,
  buildTrialBalance,
} from './reporting.builders';
import { AccountActivityRow, AccountingMethod } from './reporting.types';

/**
 * Reporting reads the immutable ledger and never mutates it. All queries run in
 * a company-scoped transaction so PostgreSQL RLS restricts them to one tenant
 * (docs/DESIGN.md §11). Only POSTED entries are included — drafts never affect
 * financials.
 *
 * `accrual` is fully implemented. `cash` basis requires reclassifying AR/AP
 * activity to cash movements and is intentionally deferred (see §11 phase 2);
 * we fail loudly rather than return a wrong number.
 */
@Injectable()
export class ReportingService {
  constructor(private readonly prisma: PrismaService) {}

  private assertAccrual(method: AccountingMethod) {
    if (method !== 'accrual') {
      throw new BadRequestException(
        `Accounting method "${method}" is not implemented yet. ` +
          `Cash-basis reporting is planned (design §11).`,
      );
    }
  }

  /**
   * Aggregate posted debit/credit per account within an optional date window.
   * `from` omitted => cumulative from inception (for Trial Balance / Balance
   * Sheet). `from` provided => period activity (for the Income Statement).
   */
  private async activity(
    tx: PrismaClient,
    companyId: string,
    to: string,
    from?: string,
  ): Promise<AccountActivityRow[]> {
    const fromClause = from
      ? Prisma.sql`AND je.entry_date >= ${from}::date`
      : Prisma.empty;

    return tx.$queryRaw<AccountActivityRow[]>(Prisma.sql`
      WITH activity AS (
        SELECT jl.account_id,
               SUM(jl.debit)  AS debit,
               SUM(jl.credit) AS credit
        FROM journal_line jl
        JOIN journal_entry je ON je.id = jl.journal_entry_id
        WHERE je.status = 'posted'
          AND je.entry_date <= ${to}::date
          ${fromClause}
        GROUP BY jl.account_id
      )
      SELECT a.code,
             a.name,
             a.type::text    AS type,
             a.subtype::text AS subtype,
             COALESCE(act.debit, 0)::text  AS debit,
             COALESCE(act.credit, 0)::text AS credit
      FROM account a
      LEFT JOIN activity act ON act.account_id = a.id
      WHERE a.company_id = ${companyId}::uuid
      ORDER BY a.code
    `);
  }

  async trialBalance(
    companyId: string,
    asOf: string,
    method: AccountingMethod = 'accrual',
  ) {
    this.assertAccrual(method);
    return this.prisma.forCompany(companyId, async (tx) => {
      const rows = await this.activity(tx, companyId, asOf);
      return buildTrialBalance(rows, asOf, method);
    });
  }

  async incomeStatement(
    companyId: string,
    from: string,
    to: string,
    method: AccountingMethod = 'accrual',
  ) {
    this.assertAccrual(method);
    return this.prisma.forCompany(companyId, async (tx) => {
      const rows = await this.activity(tx, companyId, to, from);
      return buildIncomeStatement(rows, from, to, method);
    });
  }

  async balanceSheet(
    companyId: string,
    asOf: string,
    method: AccountingMethod = 'accrual',
  ) {
    this.assertAccrual(method);
    return this.prisma.forCompany(companyId, async (tx) => {
      const rows = await this.activity(tx, companyId, asOf);
      return buildBalanceSheet(rows, asOf, method);
    });
  }
}
