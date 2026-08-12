import { Money } from '../ledger/money';

export type AccountTypeName =
  | 'asset'
  | 'liability'
  | 'equity'
  | 'income'
  | 'expense';

/** A row of aggregated ledger activity for one account over some window. */
export interface AccountActivityRow {
  code: string;
  name: string;
  type: AccountTypeName;
  subtype: string;
  debit: string; // NUMERIC as string from SQL
  credit: string;
}

export type AccountingMethod = 'accrual' | 'cash';

/** Debit-normal (assets, expenses) vs credit-normal (liab, equity, income). */
export function normalBalance(type: AccountTypeName): 'debit' | 'credit' {
  return type === 'asset' || type === 'expense' ? 'debit' : 'credit';
}

/**
 * The account's balance in its natural positive orientation:
 *   debit-normal  -> debit - credit
 *   credit-normal -> credit - debit
 */
export function signedBalance(
  type: AccountTypeName,
  debit: Money,
  credit: Money,
): Money {
  return normalBalance(type) === 'debit'
    ? debit.sub(credit)
    : credit.sub(debit);
}

// ---- Report result shapes -------------------------------------------------

export interface ReportLine {
  code?: string;
  name: string;
  amount: string;
}

export interface TrialBalanceLine {
  code: string;
  name: string;
  debit: string;
  credit: string;
}

export interface TrialBalance {
  report: 'trial_balance';
  method: AccountingMethod;
  asOf: string;
  lines: TrialBalanceLine[];
  totalDebit: string;
  totalCredit: string;
  balanced: boolean;
}

export interface ReportSection {
  title: string;
  lines: ReportLine[];
  total: string;
}

export interface IncomeStatement {
  report: 'income_statement';
  method: AccountingMethod;
  from: string;
  to: string;
  revenue: ReportSection;
  costOfGoodsSold: ReportSection;
  grossProfit: string;
  expenses: ReportSection;
  netIncome: string;
}

export interface BalanceSheet {
  report: 'balance_sheet';
  method: AccountingMethod;
  asOf: string;
  assets: ReportSection;
  liabilities: ReportSection;
  equity: ReportSection; // includes a computed "Net Income" line
  totalAssets: string;
  totalLiabilitiesAndEquity: string;
  balanced: boolean;
}
