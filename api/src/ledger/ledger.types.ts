import { Money } from './money';

/** Source document that produced a journal entry (matches Prisma JournalSource). */
export type JournalSourceType =
  | 'manual'
  | 'invoice'
  | 'bill'
  | 'payment'
  | 'bank'
  | 'payroll'
  | 'reconciliation'
  | 'opening_balance';

/** Subledger entity a line can reference (matches Prisma EntityType). */
export type LedgerEntityType = 'customer' | 'vendor' | 'employee';

/** One leg of a journal entry. Exactly one of debit/credit is > 0. */
export interface PostingLine {
  accountId: string;
  debit: Money;
  credit: Money;
  entityType?: LedgerEntityType;
  entityId?: string;
  memo?: string;
  dimensions?: Record<string, unknown>;
}

/** A complete, balanced entry ready to post. */
export interface PostingRequest {
  companyId: string;
  entryDate: Date | string;
  sourceType: JournalSourceType;
  sourceId?: string;
  currency?: string;
  memo?: string;
  createdById?: string;
  lines: PostingLine[];
}

/** Thrown when a posting is malformed or unbalanced (before it reaches the DB). */
export class PostingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PostingError';
  }
}

/**
 * Validate the fundamental double-entry invariants in-app, so we return clear
 * errors before the DB triggers reject the transaction. The DB remains the
 * ultimate authority (see prisma/sql/accounting_core_constraints.sql).
 */
export function assertBalanced(lines: PostingLine[]): void {
  if (lines.length < 2) {
    throw new PostingError('A journal entry needs at least two lines.');
  }
  for (const [i, l] of lines.entries()) {
    if (l.debit.isNegative() || l.credit.isNegative()) {
      throw new PostingError(`Line ${i}: negative amounts are not allowed.`);
    }
    const debitSet = l.debit.isPositive();
    const creditSet = l.credit.isPositive();
    if (debitSet === creditSet) {
      throw new PostingError(
        `Line ${i}: exactly one of debit/credit must be non-zero.`,
      );
    }
  }
  const totalDebit = Money.sum(lines.map((l) => l.debit));
  const totalCredit = Money.sum(lines.map((l) => l.credit));
  if (!totalDebit.eq(totalCredit)) {
    throw new PostingError(
      `Unbalanced entry: debits ${totalDebit.toString()} != credits ${totalCredit.toString()}.`,
    );
  }
}
