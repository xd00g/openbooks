/**
 * Pure bank-reconciliation logic.
 *
 *  - suggestMatches: pair imported statement lines (bank_transaction) with GL
 *    register lines on the bank account by exact amount + nearest date.
 *  - summarizeReconciliation: given a beginning balance and the cleared items,
 *    compute the ending balance and whether it ties to the statement.
 *
 * No DB — takes plain arrays, returns plain results (docs/DESIGN.md §5.4).
 * All amounts are SIGNED: + inflow to the bank, - outflow.
 */
import { Money } from '../ledger/money';

export interface BankTxn {
  id: string;
  date: string; // YYYY-MM-DD
  amount: string; // signed
}

export interface GlBankLine {
  journalEntryId: string;
  date: string; // YYYY-MM-DD
  amount: string; // signed (debit - credit on the bank GL account)
}

export interface SuggestedMatch {
  bankTransactionId: string;
  journalEntryId: string;
  amount: string;
  dateDiffDays: number;
}

export interface MatchResult {
  matches: SuggestedMatch[];
  unmatchedBank: BankTxn[];
  unmatchedGl: GlBankLine[];
}

function dayDiff(a: string, b: string): number {
  return Math.abs(
    Math.round(
      (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) /
        86_400_000,
    ),
  );
}

/**
 * Greedy one-to-one matching: for each bank txn (oldest first) pick the closest
 * unused GL line with the exact same signed amount within the date tolerance.
 */
export function suggestMatches(
  bankTxns: BankTxn[],
  glLines: GlBankLine[],
  opts: { dateToleranceDays?: number } = {},
): MatchResult {
  const tol = opts.dateToleranceDays ?? 4;
  const usedGl = new Set<number>();
  const matches: SuggestedMatch[] = [];
  const matchedBank = new Set<string>();

  const sortedBank = [...bankTxns].sort((a, b) => a.date.localeCompare(b.date));

  for (const bt of sortedBank) {
    const amt = Money.of(bt.amount);
    let best = -1;
    let bestDiff = Number.POSITIVE_INFINITY;
    for (let i = 0; i < glLines.length; i++) {
      if (usedGl.has(i)) continue;
      const gl = glLines[i];
      if (!Money.of(gl.amount).eq(amt)) continue;
      const diff = dayDiff(bt.date, gl.date);
      if (diff <= tol && diff < bestDiff) {
        best = i;
        bestDiff = diff;
      }
    }
    if (best >= 0) {
      usedGl.add(best);
      matchedBank.add(bt.id);
      matches.push({
        bankTransactionId: bt.id,
        journalEntryId: glLines[best].journalEntryId,
        amount: bt.amount,
        dateDiffDays: bestDiff,
      });
    }
  }

  return {
    matches,
    unmatchedBank: bankTxns.filter((b) => !matchedBank.has(b.id)),
    unmatchedGl: glLines.filter((_, i) => !usedGl.has(i)),
  };
}

export interface ReconciliationSummary {
  beginningBalance: string;
  statementEnding: string;
  clearedCount: number;
  clearedNet: string;
  computedEnding: string; // beginning + clearedNet
  difference: string; // statementEnding - computedEnding
  balanced: boolean;
}

export function summarizeReconciliation(
  beginningBalance: string,
  statementEnding: string,
  cleared: { amount: string }[],
): ReconciliationSummary {
  const begin = Money.of(beginningBalance);
  const ending = Money.of(statementEnding);
  const clearedNet = Money.sum(cleared.map((c) => Money.of(c.amount)));
  const computedEnding = begin.add(clearedNet);
  const difference = ending.sub(computedEnding);

  return {
    beginningBalance: begin.toString(),
    statementEnding: ending.toString(),
    clearedCount: cleared.length,
    clearedNet: clearedNet.toString(),
    computedEnding: computedEnding.toString(),
    difference: difference.toString(),
    balanced: difference.isZero(),
  };
}
