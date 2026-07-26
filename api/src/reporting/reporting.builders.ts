/**
 * Pure financial-statement builders.
 *
 * Input: aggregated ledger activity rows (one per account). Output: normalized
 * statement structures. No DB, no framework — the accounting presentation logic
 * is unit-testable in isolation. The underlying numbers come from the immutable
 * ledger (see docs/DESIGN.md §11).
 */
import { Money } from '../ledger/money';
import {
  AccountActivityRow,
  AccountingMethod,
  BalanceSheet,
  IncomeStatement,
  ReportLine,
  ReportSection,
  TrialBalance,
  TrialBalanceLine,
  signedBalance,
} from './reporting.types';

const D = (s: string) => Money.of(s);

function section(title: string, lines: ReportLine[]): ReportSection {
  const total = Money.sum(lines.map((l) => D(l.amount)));
  return { title, lines, total: total.toString() };
}

// --- Trial Balance ---------------------------------------------------------

export function buildTrialBalance(
  rows: AccountActivityRow[],
  asOf: string,
  method: AccountingMethod = 'accrual',
): TrialBalance {
  const lines: TrialBalanceLine[] = [];
  let totalDebit = Money.ZERO;
  let totalCredit = Money.ZERO;

  for (const r of rows) {
    const debit = D(r.debit);
    const credit = D(r.credit);
    if (debit.isZero() && credit.isZero()) continue; // skip inactive accounts

    const net = debit.sub(credit); // + => debit balance, - => credit balance
    const debitCol = net.isNegative() ? Money.ZERO : net;
    const creditCol = net.isNegative() ? net.neg() : Money.ZERO;

    lines.push({
      code: r.code,
      name: r.name,
      debit: debitCol.toString(),
      credit: creditCol.toString(),
    });
    totalDebit = totalDebit.add(debitCol);
    totalCredit = totalCredit.add(creditCol);
  }

  return {
    report: 'trial_balance',
    method,
    asOf,
    lines,
    totalDebit: totalDebit.toString(),
    totalCredit: totalCredit.toString(),
    balanced: totalDebit.eq(totalCredit),
  };
}

// --- Income Statement (P&L) ------------------------------------------------

export function buildIncomeStatement(
  rows: AccountActivityRow[],
  from: string,
  to: string,
  method: AccountingMethod = 'accrual',
): IncomeStatement {
  const revenueLines: ReportLine[] = [];
  const cogsLines: ReportLine[] = [];
  const expenseLines: ReportLine[] = [];

  for (const r of rows) {
    const bal = signedBalance(r.type, D(r.debit), D(r.credit));
    if (bal.isZero()) continue;
    const line: ReportLine = { code: r.code, name: r.name, amount: bal.toString() };

    if (r.type === 'income') revenueLines.push(line);
    else if (r.type === 'expense') {
      if (r.subtype === 'cost_of_goods_sold') cogsLines.push(line);
      else expenseLines.push(line);
    }
  }

  const revenue = section('Income', revenueLines);
  const costOfGoodsSold = section('Cost of Goods Sold', cogsLines);
  const expenses = section('Expenses', expenseLines);

  const grossProfit = D(revenue.total).sub(D(costOfGoodsSold.total));
  const netIncome = grossProfit.sub(D(expenses.total));

  return {
    report: 'income_statement',
    method,
    from,
    to,
    revenue,
    costOfGoodsSold,
    grossProfit: grossProfit.toString(),
    expenses,
    netIncome: netIncome.toString(),
  };
}

// --- Balance Sheet ---------------------------------------------------------

/**
 * Balance sheet as of a date. Because income/expense accounts are not closed
 * into equity in a live ledger, current earnings must be added to equity for
 * the sheet to balance:  Assets = Liabilities + Equity + NetIncome  (proven by
 * the ledger identity that every posted entry balances). The "Net Income" line
 * is computed here from the same cumulative rows. Once period-close is added,
 * this splits into Retained Earnings (prior) + Current-Year Earnings.
 */
export function buildBalanceSheet(
  rows: AccountActivityRow[],
  asOf: string,
  method: AccountingMethod = 'accrual',
): BalanceSheet {
  const assetLines: ReportLine[] = [];
  const liabilityLines: ReportLine[] = [];
  const equityLines: ReportLine[] = [];
  let netIncome = Money.ZERO;

  for (const r of rows) {
    const bal = signedBalance(r.type, D(r.debit), D(r.credit));

    if (r.type === 'asset') {
      if (!bal.isZero()) assetLines.push({ code: r.code, name: r.name, amount: bal.toString() });
    } else if (r.type === 'liability') {
      if (!bal.isZero()) liabilityLines.push({ code: r.code, name: r.name, amount: bal.toString() });
    } else if (r.type === 'equity') {
      if (!bal.isZero()) equityLines.push({ code: r.code, name: r.name, amount: bal.toString() });
    } else if (r.type === 'income') {
      netIncome = netIncome.add(bal); // income is credit-normal (positive)
    } else if (r.type === 'expense') {
      netIncome = netIncome.sub(bal); // expense is debit-normal (positive)
    }
  }

  // Add the computed current-earnings line to equity.
  equityLines.push({ name: 'Net Income', amount: netIncome.toString() });

  const assets = section('Assets', assetLines);
  const liabilities = section('Liabilities', liabilityLines);
  const equity = section('Equity', equityLines);

  const totalAssets = D(assets.total);
  const totalLE = D(liabilities.total).add(D(equity.total));

  return {
    report: 'balance_sheet',
    method,
    asOf,
    assets,
    liabilities,
    equity,
    totalAssets: totalAssets.toString(),
    totalLiabilitiesAndEquity: totalLE.toString(),
    balanced: totalAssets.eq(totalLE),
  };
}
