/**
 * Pure document math shared by Sales (invoices) and Expenses (bills):
 *   - computeDocumentTotals: line extension, tax, subtotal/total
 *   - allocatePayment: apply a payment across open documents, keeping balances
 *     and statuses correct (this is what closes the aging caveat)
 *
 * No DB — plain data in, plain data out (docs/DESIGN.md §5.3).
 */
import { Money } from '../ledger/money';

export class DocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentError';
  }
}

// --- Totals ----------------------------------------------------------------

export interface DocLineInput {
  accountId: string;
  itemId?: string;
  description?: string;
  quantity: string;
  unitPrice: string;
  taxRateId?: string;
}

export interface TaxRateInfo {
  rate: string; // e.g. "0.075000"
  liabilityAccountId: string;
}

export interface ComputedLine extends DocLineInput {
  amount: string;
}

export interface ComputedTaxLine {
  taxRateId: string;
  liabilityAccountId: string;
  taxable: string;
  taxAmount: string;
}

export interface DocumentTotals {
  lines: ComputedLine[];
  taxLines: ComputedTaxLine[];
  subtotal: string;
  taxTotal: string;
  total: string;
}

export function computeDocumentTotals(
  lines: DocLineInput[],
  taxRates: Map<string, TaxRateInfo> = new Map(),
): DocumentTotals {
  const computed: ComputedLine[] = [];
  let subtotal = Money.ZERO;

  // Accumulate tax per rate so multiple lines sharing a rate combine.
  const taxAccum = new Map<string, { taxable: Money; tax: Money }>();

  for (const l of lines) {
    const amount = Money.of(l.unitPrice).times(l.quantity);
    subtotal = subtotal.add(amount);
    computed.push({ ...l, amount: amount.toString() });

    if (l.taxRateId) {
      const info = taxRates.get(l.taxRateId);
      if (!info) {
        throw new DocumentError(`Unknown tax rate: ${l.taxRateId}`);
      }
      const tax = amount.mulRate(info.rate);
      const acc = taxAccum.get(l.taxRateId) ?? {
        taxable: Money.ZERO,
        tax: Money.ZERO,
      };
      acc.taxable = acc.taxable.add(amount);
      acc.tax = acc.tax.add(tax);
      taxAccum.set(l.taxRateId, acc);
    }
  }

  const taxLines: ComputedTaxLine[] = [...taxAccum.entries()].map(
    ([taxRateId, acc]) => ({
      taxRateId,
      liabilityAccountId: taxRates.get(taxRateId)!.liabilityAccountId,
      taxable: acc.taxable.toString(),
      taxAmount: acc.tax.toString(),
    }),
  );

  const taxTotal = Money.sum(taxLines.map((t) => Money.of(t.taxAmount)));
  const total = subtotal.add(taxTotal);

  return {
    lines: computed,
    taxLines,
    subtotal: subtotal.toString(),
    taxTotal: taxTotal.toString(),
    total: total.toString(),
  };
}

// --- Payment allocation ----------------------------------------------------

export interface OpenDoc {
  id: string;
  balanceDue: string;
}

export interface Allocation {
  docId: string;
  amount: string;
}

export type DocStatus = 'open' | 'partially_paid' | 'paid';

export interface DocUpdate {
  docId: string;
  applied: string;
  newBalance: string;
  status: DocStatus;
}

export interface AllocationResult {
  totalApplied: string;
  updates: DocUpdate[];
}

/**
 * Apply allocations to open documents. Validates that each allocation is
 * positive and does not exceed the document's remaining balance, and returns
 * the new balances + statuses. Over-application throws.
 */
export function allocatePayment(
  docs: OpenDoc[],
  allocations: Allocation[],
): AllocationResult {
  const byId = new Map(docs.map((d) => [d.id, Money.of(d.balanceDue)]));
  const updates: DocUpdate[] = [];
  let totalApplied = Money.ZERO;

  for (const a of allocations) {
    const applied = Money.of(a.amount);
    if (!applied.isPositive()) {
      throw new DocumentError(`Allocation for ${a.docId} must be positive.`);
    }
    const balance = byId.get(a.docId);
    if (balance === undefined) {
      throw new DocumentError(`Document ${a.docId} is not open for payment.`);
    }
    if (applied.gt(balance)) {
      throw new DocumentError(
        `Allocation ${applied.toString()} exceeds balance ${balance.toString()} for ${a.docId}.`,
      );
    }
    const newBalance = balance.sub(applied);
    updates.push({
      docId: a.docId,
      applied: applied.toString(),
      newBalance: newBalance.toString(),
      status: newBalance.isZero() ? 'paid' : 'partially_paid',
    });
    totalApplied = totalApplied.add(applied);
  }

  return { totalApplied: totalApplied.toString(), updates };
}
