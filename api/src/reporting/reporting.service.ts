import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildBalanceSheet,
  buildIncomeStatement,
  buildTrialBalance,
} from './reporting.builders';
import { AccountActivityRow, AccountingMethod } from './reporting.types';
import { AgingKind, OpenItem, buildAging } from './aging.builders';

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
      ? Prisma.sql`AND je."entryDate" >= ${from}::date`
      : Prisma.empty;

    return tx.$queryRaw<AccountActivityRow[]>(Prisma.sql`
      WITH activity AS (
        SELECT jl."accountId" AS account_id,
               SUM(jl.debit)  AS debit,
               SUM(jl.credit) AS credit
        FROM journal_line jl
        JOIN journal_entry je ON je.id = jl."journalEntryId"
        WHERE je.status = 'posted'
          AND je."entryDate" <= ${to}::date
          ${fromClause}
        GROUP BY jl."accountId"
      )
      SELECT a.code,
             a.name,
             a.type::text    AS type,
             a.subtype::text AS subtype,
             COALESCE(act.debit, 0)::text  AS debit,
             COALESCE(act.credit, 0)::text AS credit
      FROM account a
      LEFT JOIN activity act ON act.account_id = a.id
      WHERE a."companyId" = ${companyId}::uuid
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

  /** Open receivables, bucketed by age. */
  async arAging(companyId: string, asOf: string) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const invoices = await tx.invoice.findMany({
        where: {
          status: { in: ['open', 'partially_paid'] },
          balanceDue: { gt: 0 },
        },
        include: { customer: { select: { displayName: true } } },
      });
      const items: OpenItem[] = invoices.map((i) => ({
        id: i.id,
        ref: i.number,
        party: i.customer.displayName,
        dueDate: (i.dueDate ?? i.issueDate).toISOString().slice(0, 10),
        amount: i.balanceDue.toString(),
      }));
      return buildAging(items, asOf, 'ar' as AgingKind);
    });
  }

  /** Open payables, bucketed by age. */
  async apAging(companyId: string, asOf: string) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const bills = await tx.bill.findMany({
        where: {
          status: { in: ['open', 'partially_paid'] },
          balanceDue: { gt: 0 },
        },
        include: { vendor: { select: { displayName: true } } },
      });
      const items: OpenItem[] = bills.map((b) => ({
        id: b.id,
        ref: b.number ?? 'Bill',
        party: b.vendor.displayName,
        dueDate: (b.dueDate ?? b.issueDate).toISOString().slice(0, 10),
        amount: b.balanceDue.toString(),
      }));
      return buildAging(items, asOf, 'ap' as AgingKind);
    });
  }
}
