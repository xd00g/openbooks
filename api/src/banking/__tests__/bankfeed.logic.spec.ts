import { parseCsv, parseOfx, normalizeDate } from '../bankfeed/bankfeed.logic';

describe('normalizeDate', () => {
  it('handles ISO and US formats', () => {
    expect(normalizeDate('2026-03-02')).toBe('2026-03-02');
    expect(normalizeDate('3/2/2026')).toBe('2026-03-02');
    expect(normalizeDate('03/02/26')).toBe('2026-03-02');
  });
});

describe('parseCsv', () => {
  it('parses a signed-amount CSV and derives stable ids', () => {
    const csv = [
      'Date,Amount,Description',
      '2026-03-01,100.00,Deposit',
      '2026-03-02,"-40.00","Coffee, downtown"',
    ].join('\n');
    const a = parseCsv(csv);
    expect(a).toHaveLength(2);
    expect(a[1].amount).toBe('-40.00');
    expect(a[1].description).toBe('Coffee, downtown');
    // idempotent: same content -> same ids
    const b = parseCsv(csv);
    expect(b[0].externalId).toBe(a[0].externalId);
  });

  it('supports separate debit/credit columns', () => {
    const csv = [
      'Date,Debit,Credit,Description',
      '2026-03-05,25.00,,Withdrawal',
      '2026-03-06,,500.00,Payroll',
    ].join('\n');
    const rows = parseCsv(csv, { debit: 'debit', credit: 'credit' });
    expect(rows[0].amount).toBe('-25.00');
    expect(rows[1].amount).toBe('500.00');
  });
});

describe('parseOfx', () => {
  it('extracts STMTTRN blocks', () => {
    const ofx = `
      <STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260302120000<TRNAMT>-40.00<FITID>abc123<NAME>Coffee</STMTTRN>
      <STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260301<TRNAMT>100.00<FITID>def456<NAME>Deposit</STMTTRN>
    `;
    const rows = parseOfx(ofx);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ postedDate: '2026-03-02', amount: '-40.00', externalId: 'ofx_abc123' });
    expect(rows[1].description).toBe('Deposit');
  });
});
