import { Money } from '../../ledger/money';
import { buildClosingEntry, IncExpRow } from '../period-close.logic';

const sum = (arr: { debit: Money; credit: Money }[], side: 'debit' | 'credit') =>
  Money.sum(arr.map((l) => l[side])).toString();

describe('buildClosingEntry', () => {
  it('rolls a net profit into Retained Earnings (credit)', () => {
    const rows: IncExpRow[] = [
      { accountId: 'inc', code: '4000', name: 'Sales', type: 'income', debit: '0', credit: '10000.00' },
      { accountId: 'exp', code: '6000', name: 'Rent', type: 'expense', debit: '6000.00', credit: '0' },
    ];
    const c = buildClosingEntry(rows, 're', '2026-12-31');
    expect(c.netIncome).toBe('4000.0000');
    expect(sum(c.lines, 'debit')).toBe(sum(c.lines, 'credit')); // balanced
    const reLine = c.lines.find((l) => l.accountId === 're')!;
    expect(reLine.credit.toString()).toBe('4000.0000'); // profit credited to RE
  });

  it('rolls a net loss into Retained Earnings (debit)', () => {
    const rows: IncExpRow[] = [
      { accountId: 'inc', code: '4000', name: 'Sales', type: 'income', debit: '0', credit: '149.99' },
      { accountId: 'w', code: '6500', name: 'Wages', type: 'expense', debit: '8640.00', credit: '0' },
    ];
    const c = buildClosingEntry(rows, 're', '2026-12-31');
    expect(c.netIncome).toBe('-8490.0100');
    const reLine = c.lines.find((l) => l.accountId === 're')!;
    expect(reLine.debit.toString()).toBe('8490.0100'); // loss debited to RE
    expect(sum(c.lines, 'debit')).toBe(sum(c.lines, 'credit'));
  });

  it('produces no lines when there is nothing to close', () => {
    const c = buildClosingEntry([], 're', '2026-12-31');
    expect(c.lines).toHaveLength(0);
    expect(c.netIncome).toBe('0.0000');
  });
});
