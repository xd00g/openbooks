/**
 * Pure period-close logic — the retained-earnings roll-forward.
 *
 * A closing entry zeroes every income and expense account into Retained
 * Earnings. After it posts, the Balance Sheet's "Net Income" line reflects only
 * post-close activity, and prior earnings live in Retained Earnings (docs
 * /DESIGN.md §11). No DB — takes aggregated I/E balances, returns balanced
 * PostingLines.
 */
import { Money } from '../ledger/money';
import { PostingLine, assertBalanced } from '../ledger/ledger.types';

export interface IncExpRow {
  accountId: string;
  code: string;
  name: string;
  type: 'income' | 'expense' | string;
  debit: string;
  credit: string;
}

export interface ClosingEntry {
  lines: PostingLine[];
  netIncome: string; // credit to RE if positive, debit if negative (loss)
  closedAccounts: number;
}

/**
 * Build the closing entry. For each income/expense account we post the opposite
 * of its net balance to bring it to zero; the balancing plug goes to Retained
 * Earnings. `assertBalanced` guarantees debits == credits.
 */
export function buildClosingEntry(
  rows: IncExpRow[],
  retainedEarningsAccountId: string,
  closeDate: string,
): ClosingEntry {
  const lines: PostingLine[] = [];

  for (const r of rows) {
    const net = Money.of(r.debit).sub(Money.of(r.credit)); // debit - credit
    if (net.isZero()) continue;

    if (net.isPositive()) {
      // account carries a debit balance (typical expense) -> credit to zero
      lines.push({
        accountId: r.accountId,
        debit: Money.ZERO,
        credit: net,
        memo: `Close ${r.code} ${r.name}`,
      });
    } else {
      // account carries a credit balance (typical income) -> debit to zero
      lines.push({
        accountId: r.accountId,
        debit: net.neg(),
        credit: Money.ZERO,
        memo: `Close ${r.code} ${r.name}`,
      });
    }
  }

  const closedAccounts = lines.length;

  const sumDebit = Money.sum(lines.map((l) => l.debit));
  const sumCredit = Money.sum(lines.map((l) => l.credit));
  const plug = sumDebit.sub(sumCredit); // what RE must absorb to balance

  // netIncome = income - expenses. Income lines here are debits (to zero credit
  // balances) and expense lines are credits, so netIncome = sumDebit - sumCredit
  // = plug, with a positive plug meaning a profit credited to RE.
  const netIncome = plug;

  if (!plug.isZero()) {
    if (plug.isPositive()) {
      lines.push({
        accountId: retainedEarningsAccountId,
        debit: Money.ZERO,
        credit: plug,
        memo: 'Net income to Retained Earnings',
      });
    } else {
      lines.push({
        accountId: retainedEarningsAccountId,
        debit: plug.neg(),
        credit: Money.ZERO,
        memo: 'Net loss to Retained Earnings',
      });
    }
  }

  if (lines.length > 0) {
    assertBalanced(lines);
  }

  return {
    lines,
    netIncome: netIncome.toString(),
    closedAccounts,
  };
}
