import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  GlBankLine,
  suggestMatches,
  summarizeReconciliation,
} from './reconciliation.logic';

/**
 * Bank reconciliation. Runs company-scoped (RLS). The statement lines are
 * bank_transaction rows; reconciling means ticking them off until
 * beginning + cleared == statement ending, then locking the reconciliation.
 */
@Injectable()
export class ReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  /** Open a reconciliation session for a statement period. */
  async start(
    companyId: string,
    bankAccountId: string,
    input: {
      statementDate: string;
      beginningBalance: string;
      endingBalance: string;
    },
  ) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const bank = await tx.bankAccount.findFirst({
        where: { id: bankAccountId },
        select: { id: true },
      });
      if (!bank) throw new NotFoundException('Bank account not found.');

      return tx.reconciliation.create({
        data: {
          companyId,
          bankAccountId,
          statementDate: new Date(input.statementDate),
          beginningBalance: input.beginningBalance,
          endingBalance: input.endingBalance,
          status: 'in_progress',
        },
      });
    });
  }

  /** Suggest GL matches for still-unreconciled statement lines. */
  async suggestions(
    companyId: string,
    bankAccountId: string,
    dateToleranceDays = 4,
  ) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const bank = await tx.bankAccount.findFirst({
        where: { id: bankAccountId },
        select: { accountId: true },
      });
      if (!bank) throw new NotFoundException('Bank account not found.');

      const bankTxns = await tx.bankTransaction.findMany({
        where: { bankAccountId, reconciliationId: null },
        select: { id: true, postedDate: true, amount: true },
      });

      const glRows = await tx.$queryRaw<
        { journalEntryId: string; date: Date; amount: string }[]
      >(Prisma.sql`
        SELECT jl."journalEntryId" AS "journalEntryId",
               je."entryDate"      AS date,
               (jl.debit - jl.credit)::text AS amount
        FROM journal_line jl
        JOIN journal_entry je ON je.id = jl."journalEntryId"
        WHERE je.status = 'posted'
          AND jl."accountId" = ${bank.accountId}::uuid
      `);

      const glLines: GlBankLine[] = glRows.map((r) => ({
        journalEntryId: r.journalEntryId,
        date: r.date.toISOString().slice(0, 10),
        amount: r.amount,
      }));

      return suggestMatches(
        bankTxns.map((b) => ({
          id: b.id,
          date: b.postedDate.toISOString().slice(0, 10),
          amount: b.amount.toString(),
        })),
        glLines,
        { dateToleranceDays },
      );
    });
  }

  /** Link a statement line to its GL entry (categorization). */
  async match(companyId: string, bankTransactionId: string, journalEntryId: string) {
    return this.prisma.forCompany(companyId, async (tx) => {
      await this.getBankTxn(tx, bankTransactionId);
      return tx.bankTransaction.update({
        where: { id: bankTransactionId },
        data: { journalEntryId, status: 'matched' },
      });
    });
  }

  /** Tick/untick a statement line for the given reconciliation. */
  async setCleared(
    companyId: string,
    reconciliationId: string,
    bankTransactionId: string,
    cleared: boolean,
  ) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const rec = await this.getRec(tx, reconciliationId);
      if (rec.status !== 'in_progress') {
        throw new ConflictException('Reconciliation is locked.');
      }
      const txn = await this.getBankTxn(tx, bankTransactionId);
      if (txn.bankAccountId !== rec.bankAccountId) {
        throw new BadRequestException(
          'Transaction belongs to a different bank account.',
        );
      }
      return tx.bankTransaction.update({
        where: { id: bankTransactionId },
        data: { reconciliationId: cleared ? reconciliationId : null },
      });
    });
  }

  /** Current cleared/difference summary for an in-progress reconciliation. */
  async summary(companyId: string, reconciliationId: string) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const rec = await this.getRec(tx, reconciliationId);
      const cleared = await tx.bankTransaction.findMany({
        where: { reconciliationId },
        select: { amount: true },
      });
      return summarizeReconciliation(
        rec.beginningBalance.toString(),
        rec.endingBalance.toString(),
        cleared.map((c) => ({ amount: c.amount.toString() })),
      );
    });
  }

  /** Finalize and lock — only if the statement ties out. */
  async complete(companyId: string, reconciliationId: string) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const rec = await this.getRec(tx, reconciliationId);
      if (rec.status !== 'in_progress') {
        throw new ConflictException('Reconciliation already completed.');
      }
      const cleared = await tx.bankTransaction.findMany({
        where: { reconciliationId },
        select: { amount: true },
      });
      const summary = summarizeReconciliation(
        rec.beginningBalance.toString(),
        rec.endingBalance.toString(),
        cleared.map((c) => ({ amount: c.amount.toString() })),
      );
      if (!summary.balanced) {
        throw new BadRequestException(
          `Cannot complete: off by ${summary.difference}. ` +
            `Clear or unclear transactions until the difference is 0.`,
        );
      }
      await tx.reconciliation.update({
        where: { id: reconciliationId },
        data: { status: 'completed', completedAt: new Date() },
      });
      return { ...summary, status: 'completed' as const };
    });
  }

  /** List reconciliations, optionally for one bank account. */
  list(companyId: string, bankAccountId?: string) {
    return this.prisma.forCompany(companyId, (tx) =>
      tx.reconciliation.findMany({
        where: bankAccountId ? { bankAccountId } : {},
        orderBy: { statementDate: 'desc' },
      }),
    );
  }

  /** A reconciliation with its cleared transactions. */
  get(companyId: string, id: string) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const rec = await this.getRec(tx, id);
      const cleared = await tx.bankTransaction.findMany({
        where: { reconciliationId: id },
        orderBy: { postedDate: 'asc' },
      });
      return { ...rec, transactions: cleared };
    });
  }

  private async getRec(tx: PrismaClient, id: string) {
    const rec = await tx.reconciliation.findFirst({ where: { id } });
    if (!rec) throw new NotFoundException('Reconciliation not found.');
    return rec;
  }

  private async getBankTxn(tx: PrismaClient, id: string) {
    const txn = await tx.bankTransaction.findFirst({ where: { id } });
    if (!txn) throw new NotFoundException('Bank transaction not found.');
    return txn;
  }
}
