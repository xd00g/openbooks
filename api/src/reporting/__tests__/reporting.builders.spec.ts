import { AccountActivityRow } from '../reporting.types';
import {
  buildBalanceSheet,
  buildIncomeStatement,
  buildTrialBalance,
} from '../reporting.builders';

/**
 * A synthetic but internally consistent dataset built from three balanced
 * postings (each debit == credit), so all accounting identities must hold:
 *
 *  1. Invoice $161.24: Dr AR 161.24 / Cr Services 149.99 / Cr Sales Tax 11.25
 *  2. Payment $100.00: Dr Checking 100.00 / Cr AR 100.00
 *  3. Payroll: Dr Wages 8000 + Dr Employer Tax Exp 640 /
 *             Cr Checking 5700 + Cr EE Withholding 1850 + Cr Deductions 450 +
 *             Cr Employer Tax Payable 640
 */
const rows: AccountActivityRow[] = [
  { code: '1010', name: 'Business Checking', type: 'asset', subtype: 'bank', debit: '100.00', credit: '5700.00' },
  { code: '1100', name: 'Accounts Receivable', type: 'asset', subtype: 'accounts_receivable', debit: '161.24', credit: '100.00' },
  { code: '2200', name: 'Sales Tax Payable', type: 'liability', subtype: 'sales_tax_payable', debit: '0', credit: '11.25' },
  { code: '2310', name: 'Employee Tax Withholding', type: 'liability', subtype: 'payroll_liability', debit: '0', credit: '1850.00' },
  { code: '2320', name: 'Employer Payroll Taxes Payable', type: 'liability', subtype: 'payroll_liability', debit: '0', credit: '640.00' },
  { code: '2330', name: 'Deductions Payable', type: 'liability', subtype: 'payroll_liability', debit: '0', credit: '450.00' },
  { code: '4100', name: 'Services Income', type: 'income', subtype: 'income', debit: '0', credit: '149.99' },
  { code: '6500', name: 'Payroll Wages', type: 'expense', subtype: 'expense', debit: '8000.00', credit: '0' },
  { code: '6510', name: 'Employer Payroll Taxes', type: 'expense', subtype: 'expense', debit: '640.00', credit: '0' },
];

describe('Trial Balance', () => {
  const tb = buildTrialBalance(rows, '2026-12-31');
  it('total debits equal total credits', () => {
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });
});

describe('Income Statement', () => {
  const is = buildIncomeStatement(rows, '2026-01-01', '2026-12-31');
  it('net income = income - expenses', () => {
    // 149.99 - (8000 + 640) = -8490.01
    expect(is.netIncome).toBe('-8490.0100');
    expect(is.revenue.total).toBe('149.9900');
    expect(is.expenses.total).toBe('8640.0000');
  });
});

describe('Balance Sheet', () => {
  const bs = buildBalanceSheet(rows, '2026-12-31');
  it('assets = liabilities + equity (incl. net income)', () => {
    expect(bs.balanced).toBe(true);
    expect(bs.totalAssets).toBe(bs.totalLiabilitiesAndEquity);
  });
  it('includes a computed Net Income line in equity', () => {
    const ni = bs.equity.lines.find((l) => l.name === 'Net Income');
    expect(ni?.amount).toBe('-8490.0100');
  });
});
