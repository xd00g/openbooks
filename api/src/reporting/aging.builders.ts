/**
 * Pure AR/AP aging.
 *
 * Buckets open items by days past due relative to a reference date. No DB —
 * takes a flat list of open items, returns a grouped aging report. Same
 * approach for receivables and payables (docs/DESIGN.md §11).
 */
import { Money } from '../ledger/money';

export type AgingKind = 'ar' | 'ap';

export interface OpenItem {
  id: string;
  ref: string; // invoice/bill number
  party: string; // customer or vendor name
  dueDate: string; // YYYY-MM-DD (fall back to issue date upstream)
  amount: string; // open balance
}

export const AGING_BUCKETS = ['current', '1-30', '31-60', '61-90', '90+'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export interface AgingItem extends OpenItem {
  daysPastDue: number;
  bucket: AgingBucket;
}

export interface AgingPartyGroup {
  party: string;
  buckets: Record<AgingBucket, string>;
  total: string;
  items: AgingItem[];
}

export interface AgingReport {
  report: 'aging';
  kind: AgingKind;
  asOf: string;
  parties: AgingPartyGroup[];
  totals: Record<AgingBucket, string>;
  grandTotal: string;
}

function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.parse(`${fromISO}T00:00:00Z`);
  const b = Date.parse(`${toISO}T00:00:00Z`);
  return Math.floor((b - a) / 86_400_000);
}

export function bucketFor(daysPastDue: number): AgingBucket {
  if (daysPastDue <= 0) return 'current';
  if (daysPastDue <= 30) return '1-30';
  if (daysPastDue <= 60) return '31-60';
  if (daysPastDue <= 90) return '61-90';
  return '90+';
}

function emptyBuckets(): Record<AgingBucket, Money> {
  return {
    current: Money.ZERO,
    '1-30': Money.ZERO,
    '31-60': Money.ZERO,
    '61-90': Money.ZERO,
    '90+': Money.ZERO,
  };
}

export function buildAging(
  items: OpenItem[],
  asOf: string,
  kind: AgingKind,
): AgingReport {
  const grand = emptyBuckets();
  const byParty = new Map<
    string,
    { buckets: Record<AgingBucket, Money>; items: AgingItem[] }
  >();

  for (const it of items) {
    const amount = Money.of(it.amount);
    if (amount.isZero()) continue;
    const daysPastDue = daysBetween(it.dueDate, asOf);
    const bucket = bucketFor(daysPastDue);

    if (!byParty.has(it.party)) {
      byParty.set(it.party, { buckets: emptyBuckets(), items: [] });
    }
    const g = byParty.get(it.party)!;
    g.buckets[bucket] = g.buckets[bucket].add(amount);
    g.items.push({ ...it, daysPastDue, bucket });
    grand[bucket] = grand[bucket].add(amount);
  }

  const toStr = (b: Record<AgingBucket, Money>): Record<AgingBucket, string> => ({
    current: b.current.toString(),
    '1-30': b['1-30'].toString(),
    '31-60': b['31-60'].toString(),
    '61-90': b['61-90'].toString(),
    '90+': b['90+'].toString(),
  });

  const parties: AgingPartyGroup[] = [...byParty.entries()]
    .map(([party, g]) => ({
      party,
      buckets: toStr(g.buckets),
      total: Money.sum(Object.values(g.buckets)).toString(),
      items: g.items.sort((a, z) => z.daysPastDue - a.daysPastDue),
    }))
    .sort((a, z) => a.party.localeCompare(z.party));

  return {
    report: 'aging',
    kind,
    asOf,
    parties,
    totals: toStr(grand),
    grandTotal: Money.sum(Object.values(grand)).toString(),
  };
}
