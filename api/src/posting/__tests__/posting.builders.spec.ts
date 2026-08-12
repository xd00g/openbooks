import { Money } from '../../ledger/money';
import { PostingError, PostingLine, assertBalanced } from '../../ledger/ledger.types';
import {
  buildInvoicePosting,
  buildPaymentPaidPosting,
  buildPaymentReceivedPosting,
  buildPayrollPosting,
} from '../posting.builders';

const totalDebit = (l: PostingLine[]) => Money.sum(l.map((x) => x.debit));
const totalCredit = (l: PostingLine[]) => Money.sum(l.map((x) => x.credit));
const expectBalanced = (l: PostingLine[]) =>
  expect(totalDebit(l).toString()).toEqual(totalCredit(l).toString());

describe('Money', () => {
  it('parses and formats exactly at 4dp', () => {
    expect(Money.of('123.45').toString()).toBe('123.4500');
    expect(Money.of('0.1').add(Money.of('0.2')).toString()).toBe('0.3000');
  });
  it('computes tax half-up to 4dp', () => {
    // 19.99 * 7.5% = 1.49925 -> 1.4993
    expect(Money.of('19.99').mulRate('0.075').toString()).toBe('1.4993');
  });
});

describe('buildInvoicePosting', () => {
  it('balances AR against income + tax', () => {
    const lines = buildInvoicePosting({
      arAccountId: 'ar',
      customerId: 'cust',
      lines: [
        { accountId: 'inc1', amount: '100.00' },
        { accountId: 'inc2', amount: '49.99' },
      ],
      taxLines: [{ liabilityAccountId: 'tax', taxAmount: '11.25' }],
    });
    expectBalanced(lines);
    // AR debit == 100 + 49.99 + 11.25
    expect(lines[0].debit.toString()).toBe('161.2400');
  });
});

describe('payments', () => {
  it('received: Dr deposit / Cr AR', () => {
    const lines = buildPaymentReceivedPosting({
      depositAccountId: 'bank',
      arAccountId: 'ar',
      amount: '161.24',
      customerId: 'cust',
    });
    expectBalanced(lines);
  });
  it('paid: Dr AP / Cr bank', () => {
    const lines = buildPaymentPaidPosting({
      bankAccountId: 'bank',
      apAccountId: 'ap',
      amount: '500.00',
      vendorId: 'vend',
    });
    expectBalanced(lines);
  });
});

describe('buildPayrollPosting', () => {
  const accounts = {
    wageExpenseId: 'wage',
    employerTaxExpenseId: 'ertax-exp',
    cashAccountId: 'cash',
    employeeTaxLiabilityId: 'ee-liab',
    deductionsLiabilityId: 'ded-liab',
    employerTaxLiabilityId: 'er-liab',
  };

  it('balances a multi-employee run', () => {
    const lines = buildPayrollPosting(accounts, [
      { employeeId: 'e1', gross: '5000.00', employeeTaxes: '1200.00', employerTaxes: '400.00', deductions: '300.00', net: '3500.00' },
      { employeeId: 'e2', gross: '3000.00', employeeTaxes: '650.00', employerTaxes: '240.00', deductions: '150.00', net: '2200.00' },
    ]);
    expectBalanced(lines);
  });

  it('rejects a line where gross != net + taxes + deductions', () => {
    expect(() =>
      buildPayrollPosting(accounts, [
        { employeeId: 'e1', gross: '5000.00', employeeTaxes: '1200.00', employerTaxes: '400.00', deductions: '300.00', net: '9999.00' },
      ]),
    ).toThrow(PostingError);
  });
});

describe('assertBalanced', () => {
  it('rejects unbalanced entries', () => {
    expect(() =>
      assertBalanced([
        { accountId: 'a', debit: Money.of('10'), credit: Money.ZERO },
        { accountId: 'b', debit: Money.ZERO, credit: Money.of('9.99') },
      ]),
    ).toThrow(PostingError);
  });
  it('rejects two-sided lines', () => {
    expect(() =>
      assertBalanced([
        { accountId: 'a', debit: Money.of('10'), credit: Money.of('10') },
        { accountId: 'b', debit: Money.ZERO, credit: Money.of('10') },
      ]),
    ).toThrow(PostingError);
  });
});
