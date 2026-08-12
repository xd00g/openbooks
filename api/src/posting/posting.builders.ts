/**
 * Pure posting builders.
 *
 * Each function turns a plain description of a business document into a
 * balanced array of PostingLine. NO Prisma, NO NestJS, NO I/O — just data in,
 * balanced double-entry out. This is what makes the accounting rules unit-
 * testable in isolation (see __tests__/posting.builders.spec.ts).
 *
 * The debit/credit mappings follow docs/DESIGN.md §5.3.
 */
import { Money } from '../ledger/money';
import {
  PostingError,
  PostingLine,
  assertBalanced,
} from '../ledger/ledger.types';

// ---------------------------------------------------------------------------
// INVOICE  ->  Dr Accounts Receivable / Cr Income (+ Cr Sales Tax Payable)
// ---------------------------------------------------------------------------

export interface InvoicePostingInput {
  arAccountId: string;
  customerId: string;
  lines: { accountId: string; amount: string }[]; // income lines
  taxLines?: { liabilityAccountId: string; taxAmount: string }[];
}

export function buildInvoicePosting(input: InvoicePostingInput): PostingLine[] {
  if (input.lines.length === 0) {
    throw new PostingError('Invoice has no lines to post.');
  }
  const incomeLines: PostingLine[] = input.lines.map((l) => ({
    accountId: l.accountId,
    debit: Money.ZERO,
    credit: Money.of(l.amount),
    memo: 'Invoice income',
  }));

  const taxLines: PostingLine[] = (input.taxLines ?? [])
    .filter((t) => !Money.of(t.taxAmount).isZero())
    .map((t) => ({
      accountId: t.liabilityAccountId,
      debit: Money.ZERO,
      credit: Money.of(t.taxAmount),
      memo: 'Sales tax',
    }));

  const total = Money.sum(
    [...incomeLines, ...taxLines].map((l) => l.credit),
  );

  const arLine: PostingLine = {
    accountId: input.arAccountId,
    debit: total,
    credit: Money.ZERO,
    entityType: 'customer',
    entityId: input.customerId,
    memo: 'Accounts receivable',
  };

  const lines = [arLine, ...incomeLines, ...taxLines];
  assertBalanced(lines);
  return lines;
}

// ---------------------------------------------------------------------------
// BILL  ->  Dr Expense/Asset / Cr Accounts Payable
// (Tax on purchases is left to a later phase; see docs/DESIGN.md §12/§17.)
// ---------------------------------------------------------------------------

export interface BillPostingInput {
  apAccountId: string;
  vendorId: string;
  lines: { accountId: string; amount: string }[]; // expense/asset lines
}

export function buildBillPosting(input: BillPostingInput): PostingLine[] {
  if (input.lines.length === 0) {
    throw new PostingError('Bill has no lines to post.');
  }
  const expenseLines: PostingLine[] = input.lines.map((l) => ({
    accountId: l.accountId,
    debit: Money.of(l.amount),
    credit: Money.ZERO,
    memo: 'Bill expense',
  }));

  const total = Money.sum(expenseLines.map((l) => l.debit));

  const apLine: PostingLine = {
    accountId: input.apAccountId,
    debit: Money.ZERO,
    credit: total,
    entityType: 'vendor',
    entityId: input.vendorId,
    memo: 'Accounts payable',
  };

  const lines = [...expenseLines, apLine];
  assertBalanced(lines);
  return lines;
}

// ---------------------------------------------------------------------------
// PAYMENT RECEIVED  ->  Dr Bank/Undeposited / Cr Accounts Receivable
// ---------------------------------------------------------------------------

export interface PaymentReceivedInput {
  depositAccountId: string;
  arAccountId: string;
  amount: string;
  customerId: string;
}

export function buildPaymentReceivedPosting(
  input: PaymentReceivedInput,
): PostingLine[] {
  const amount = Money.of(input.amount);
  if (!amount.isPositive()) {
    throw new PostingError('Payment amount must be positive.');
  }
  const lines: PostingLine[] = [
    {
      accountId: input.depositAccountId,
      debit: amount,
      credit: Money.ZERO,
      memo: 'Payment received',
    },
    {
      accountId: input.arAccountId,
      debit: Money.ZERO,
      credit: amount,
      entityType: 'customer',
      entityId: input.customerId,
      memo: 'Applied to receivable',
    },
  ];
  assertBalanced(lines);
  return lines;
}

// ---------------------------------------------------------------------------
// PAYMENT MADE  ->  Dr Accounts Payable / Cr Bank
// ---------------------------------------------------------------------------

export interface PaymentPaidInput {
  bankAccountId: string;
  apAccountId: string;
  amount: string;
  vendorId: string;
}

export function buildPaymentPaidPosting(input: PaymentPaidInput): PostingLine[] {
  const amount = Money.of(input.amount);
  if (!amount.isPositive()) {
    throw new PostingError('Payment amount must be positive.');
  }
  const lines: PostingLine[] = [
    {
      accountId: input.apAccountId,
      debit: amount,
      credit: Money.ZERO,
      entityType: 'vendor',
      entityId: input.vendorId,
      memo: 'Applied to payable',
    },
    {
      accountId: input.bankAccountId,
      debit: Money.ZERO,
      credit: amount,
      memo: 'Payment made',
    },
  ];
  assertBalanced(lines);
  return lines;
}

// ---------------------------------------------------------------------------
// PAYROLL RUN (light / manual)  ->  see docs/DESIGN.md §12
//   Dr Wage expense (gross)
//   Dr Employer payroll-tax expense (employer taxes)
//   Cr Cash / net pay          (net)
//   Cr Employee-tax liability   (withheld)
//   Cr Deductions payable       (benefits, etc.)
//   Cr Employer-tax liability    (employer taxes)
// Invariant: gross = net + employeeTaxes + deductions  (validated per line).
// ---------------------------------------------------------------------------

export interface PayrollAccounts {
  wageExpenseId: string;
  employerTaxExpenseId: string;
  cashAccountId: string;
  employeeTaxLiabilityId: string;
  deductionsLiabilityId: string;
  employerTaxLiabilityId: string;
}

export interface PayrollLineInput {
  employeeId: string;
  gross: string;
  employeeTaxes: string;
  employerTaxes: string;
  deductions: string;
  net: string;
}

export function buildPayrollPosting(
  accounts: PayrollAccounts,
  runLines: PayrollLineInput[],
): PostingLine[] {
  if (runLines.length === 0) {
    throw new PostingError('Payroll run has no employee lines.');
  }

  let grossTot = Money.ZERO;
  let empTaxTot = Money.ZERO;
  let erTaxTot = Money.ZERO;
  let dedTot = Money.ZERO;
  let netTot = Money.ZERO;

  for (const [i, l] of runLines.entries()) {
    const gross = Money.of(l.gross);
    const empTax = Money.of(l.employeeTaxes);
    const erTax = Money.of(l.employerTaxes);
    const ded = Money.of(l.deductions);
    const net = Money.of(l.net);

    // The defining payroll identity — reject data that can't balance.
    const expectedNet = gross.sub(empTax).sub(ded);
    if (!expectedNet.eq(net)) {
      throw new PostingError(
        `Payroll line ${i} (employee ${l.employeeId}): gross - employeeTaxes - ` +
          `deductions (${expectedNet.toString()}) != net (${net.toString()}).`,
      );
    }

    grossTot = grossTot.add(gross);
    empTaxTot = empTaxTot.add(empTax);
    erTaxTot = erTaxTot.add(erTax);
    dedTot = dedTot.add(ded);
    netTot = netTot.add(net);
  }

  const lines: PostingLine[] = [];
  // Debits (expenses)
  if (grossTot.isPositive()) {
    lines.push({
      accountId: accounts.wageExpenseId,
      debit: grossTot,
      credit: Money.ZERO,
      memo: 'Gross wages',
    });
  }
  if (erTaxTot.isPositive()) {
    lines.push({
      accountId: accounts.employerTaxExpenseId,
      debit: erTaxTot,
      credit: Money.ZERO,
      memo: 'Employer payroll taxes',
    });
  }
  // Credits (cash + liabilities)
  if (netTot.isPositive()) {
    lines.push({
      accountId: accounts.cashAccountId,
      debit: Money.ZERO,
      credit: netTot,
      memo: 'Net pay',
    });
  }
  if (empTaxTot.isPositive()) {
    lines.push({
      accountId: accounts.employeeTaxLiabilityId,
      debit: Money.ZERO,
      credit: empTaxTot,
      memo: 'Employee tax withholding',
    });
  }
  if (dedTot.isPositive()) {
    lines.push({
      accountId: accounts.deductionsLiabilityId,
      debit: Money.ZERO,
      credit: dedTot,
      memo: 'Deductions payable',
    });
  }
  if (erTaxTot.isPositive()) {
    lines.push({
      accountId: accounts.employerTaxLiabilityId,
      debit: Money.ZERO,
      credit: erTaxTot,
      memo: 'Employer tax payable',
    });
  }

  assertBalanced(lines);
  return lines;
}
