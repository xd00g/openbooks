import {
  DocumentError,
  allocatePayment,
  computeDocumentTotals,
} from '../document.logic';

describe('computeDocumentTotals', () => {
  it('extends lines, applies tax, and totals', () => {
    const totals = computeDocumentTotals(
      [
        { accountId: 'inc', quantity: '2', unitPrice: '50.00', taxRateId: 'r1' },
        { accountId: 'inc', quantity: '1', unitPrice: '49.99', taxRateId: 'r1' },
      ],
      new Map([['r1', { rate: '0.075', liabilityAccountId: 'tax' }]]),
    );
    expect(totals.subtotal).toBe('149.9900');
    // 149.99 * 7.5% = 11.24925 -> 11.2493
    expect(totals.taxTotal).toBe('11.2493');
    expect(totals.total).toBe('161.2393');
    expect(totals.taxLines).toHaveLength(1);
  });

  it('supports negative lines for corrections / credit memos', () => {
    const totals = computeDocumentTotals(
      [
        { accountId: 'inc', quantity: '1', unitPrice: '100.00' },
        { accountId: 'inc', quantity: '1', unitPrice: '-30.00' }, // correction
      ],
      new Map(),
    );
    expect(totals.subtotal).toBe('70.0000');
    expect(totals.total).toBe('70.0000');
  });

  it('allows a fully negative document (credit memo)', () => {
    const totals = computeDocumentTotals(
      [{ accountId: 'inc', quantity: '1', unitPrice: '-50.00' }],
      new Map(),
    );
    expect(totals.total).toBe('-50.0000');
  });

  it('throws on an unknown tax rate', () => {
    expect(() =>
      computeDocumentTotals([
        { accountId: 'a', quantity: '1', unitPrice: '10', taxRateId: 'missing' },
      ]),
    ).toThrow(DocumentError);
  });
});

describe('allocatePayment', () => {
  it('applies across docs and sets statuses', () => {
    const res = allocatePayment(
      [
        { id: 'i1', balanceDue: '100.00' },
        { id: 'i2', balanceDue: '60.00' },
      ],
      [
        { docId: 'i1', amount: '100.00' }, // fully paid
        { docId: 'i2', amount: '40.00' }, // partial
      ],
    );
    expect(res.totalApplied).toBe('140.0000');
    expect(res.updates.find((u) => u.docId === 'i1')?.status).toBe('paid');
    expect(res.updates.find((u) => u.docId === 'i2')?.status).toBe('partially_paid');
    expect(res.updates.find((u) => u.docId === 'i2')?.newBalance).toBe('20.0000');
  });

  it('rejects over-application', () => {
    expect(() =>
      allocatePayment(
        [{ id: 'i1', balanceDue: '50.00' }],
        [{ docId: 'i1', amount: '75.00' }],
      ),
    ).toThrow(DocumentError);
  });
});
