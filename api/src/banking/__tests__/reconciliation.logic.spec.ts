import {
  suggestMatches,
  summarizeReconciliation,
} from '../reconciliation.logic';

describe('suggestMatches', () => {
  it('matches by exact amount and nearest date within tolerance', () => {
    const bank = [
      { id: 'b1', date: '2026-03-02', amount: '100.00' },
      { id: 'b2', date: '2026-03-05', amount: '-40.00' },
      { id: 'b3', date: '2026-03-10', amount: '999.00' }, // no GL match
    ];
    const gl = [
      { journalEntryId: 'j1', date: '2026-03-01', amount: '100.00' },
      { journalEntryId: 'j2', date: '2026-03-06', amount: '-40.00' },
      { journalEntryId: 'j3', date: '2026-03-01', amount: '55.00' },
    ];
    const res = suggestMatches(bank, gl, { dateToleranceDays: 4 });
    expect(res.matches).toHaveLength(2);
    expect(res.matches.find((m) => m.bankTransactionId === 'b1')?.journalEntryId).toBe('j1');
    expect(res.unmatchedBank.map((b) => b.id)).toEqual(['b3']);
    expect(res.unmatchedGl.map((g) => g.journalEntryId)).toEqual(['j3']);
  });

  it('does not match outside the date tolerance', () => {
    const res = suggestMatches(
      [{ id: 'b1', date: '2026-03-01', amount: '10.00' }],
      [{ journalEntryId: 'j1', date: '2026-04-01', amount: '10.00' }],
      { dateToleranceDays: 4 },
    );
    expect(res.matches).toHaveLength(0);
  });
});

describe('summarizeReconciliation', () => {
  it('balances when beginning + cleared == ending', () => {
    const s = summarizeReconciliation('1000.00', '1060.00', [
      { amount: '100.00' },
      { amount: '-40.00' },
    ]);
    expect(s.computedEnding).toBe('1060.0000');
    expect(s.difference).toBe('0.0000');
    expect(s.balanced).toBe(true);
  });

  it('reports the difference when it does not tie', () => {
    const s = summarizeReconciliation('1000.00', '1100.00', [
      { amount: '60.00' },
    ]);
    expect(s.difference).toBe('40.0000');
    expect(s.balanced).toBe(false);
  });
});
