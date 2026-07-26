import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money, startOfYear, today } from '../lib/format';
import { Page, Card, Table, Empty } from '../components/ui';

type R = 'trial-balance' | 'income-statement' | 'balance-sheet' | 'ar-aging' | 'ap-aging';
const TABS: { key: R; label: string }[] = [
  { key: 'trial-balance', label: 'Trial Balance' },
  { key: 'income-statement', label: 'Profit & Loss' },
  { key: 'balance-sheet', label: 'Balance Sheet' },
  { key: 'ar-aging', label: 'A/R Aging' },
  { key: 'ap-aging', label: 'A/P Aging' },
];

export default function Reports() {
  const { companyId } = useAuth();
  const [tab, setTab] = useState<R>('trial-balance');
  const [asOf, setAsOf] = useState(today());
  const [from, setFrom] = useState(startOfYear());

  const url =
    tab === 'income-statement'
      ? `/reports/income-statement?from=${from}&to=${asOf}`
      : `/reports/${tab}?asOf=${asOf}`;

  const q = useQuery({ queryKey: [tab, companyId, asOf, from], enabled: !!companyId, queryFn: () => api.get(url) });

  if (!companyId) return <Page title="Reports"><Empty>Select a company.</Empty></Page>;

  return (
    <Page title="Reports">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === t.key ? 'bg-slate-900 text-white' : 'border border-slate-300 text-slate-700 hover:bg-slate-50'}`}
          >
            {t.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 text-sm">
          {tab === 'income-statement' && (
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1" />
          )}
          <span className="text-slate-400">{tab === 'income-statement' ? 'to' : 'as of'}</span>
          <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1" />
        </div>
      </div>

      {q.isLoading && <div className="text-sm text-slate-400">Loading…</div>}
      {q.error && <div className="text-sm text-red-600">{(q.error as Error).message}</div>}
      {q.data && tab === 'trial-balance' && <TrialBalance d={q.data} />}
      {q.data && tab === 'income-statement' && <IncomeStatement d={q.data} />}
      {q.data && tab === 'balance-sheet' && <BalanceSheet d={q.data} />}
      {q.data && (tab === 'ar-aging' || tab === 'ap-aging') && <Aging d={q.data} />}
    </Page>
  );
}

function Badge({ ok }: { ok: boolean }) {
  return <span className={`ml-2 text-xs ${ok ? 'text-emerald-600' : 'text-red-600'}`}>{ok ? '✓ balanced' : '✗ out of balance'}</span>;
}

function TrialBalance({ d }: { d: any }) {
  return (
    <Table head={['Code', 'Account', 'Debit', 'Credit']}>
      {d.lines.map((l: any) => (
        <tr key={l.code}>
          <td className="px-4 py-2 text-slate-500">{l.code}</td>
          <td className="px-4 py-2">{l.name}</td>
          <td className="px-4 py-2 text-right">{Number(l.debit) ? money(l.debit) : ''}</td>
          <td className="px-4 py-2 text-right">{Number(l.credit) ? money(l.credit) : ''}</td>
        </tr>
      ))}
      <tr className="font-semibold">
        <td className="px-4 py-2" colSpan={2}>Totals<Badge ok={d.balanced} /></td>
        <td className="px-4 py-2 text-right">{money(d.totalDebit)}</td>
        <td className="px-4 py-2 text-right">{money(d.totalCredit)}</td>
      </tr>
    </Table>
  );
}

function Section({ title, s }: { title: string; s: any }) {
  return (
    <div className="mb-4">
      <div className="mb-1 text-sm font-semibold text-slate-700">{title}</div>
      <div className="rounded-lg border border-slate-200 bg-white">
        {s.lines.length === 0 && <div className="px-4 py-2 text-sm text-slate-400">—</div>}
        {s.lines.map((l: any, i: number) => (
          <div key={i} className="flex justify-between px-4 py-1.5 text-sm">
            <span className="text-slate-600">{l.name}</span><span>{money(l.amount)}</span>
          </div>
        ))}
        <div className="flex justify-between border-t px-4 py-1.5 text-sm font-semibold">
          <span>Total {title}</span><span>{money(s.total)}</span>
        </div>
      </div>
    </div>
  );
}

function IncomeStatement({ d }: { d: any }) {
  return (
    <Card>
      <Section title="Income" s={d.revenue} />
      <Section title="Cost of Goods Sold" s={d.costOfGoodsSold} />
      <div className="mb-4 flex justify-between text-sm font-semibold text-slate-800"><span>Gross profit</span><span>{money(d.grossProfit)}</span></div>
      <Section title="Expenses" s={d.expenses} />
      <div className="flex justify-between text-base font-bold text-slate-900"><span>Net income</span><span>{money(d.netIncome)}</span></div>
    </Card>
  );
}

function BalanceSheet({ d }: { d: any }) {
  return (
    <Card>
      <Section title="Assets" s={d.assets} />
      <Section title="Liabilities" s={d.liabilities} />
      <Section title="Equity" s={d.equity} />
      <div className="flex justify-between text-sm font-bold text-slate-900">
        <span>Assets = Liabilities + Equity<Badge ok={d.balanced} /></span>
        <span>{money(d.totalAssets)} = {money(d.totalLiabilitiesAndEquity)}</span>
      </div>
    </Card>
  );
}

function Aging({ d }: { d: any }) {
  return (
    <Table head={[d.kind === 'ar' ? 'Customer' : 'Vendor', 'Current', '1-30', '31-60', '61-90', '90+', 'Total']}>
      {d.parties.map((p: any) => (
        <tr key={p.party}>
          <td className="px-4 py-2">{p.party}</td>
          <td className="px-4 py-2 text-right">{money(p.buckets.current)}</td>
          <td className="px-4 py-2 text-right">{money(p.buckets['1-30'])}</td>
          <td className="px-4 py-2 text-right">{money(p.buckets['31-60'])}</td>
          <td className="px-4 py-2 text-right">{money(p.buckets['61-90'])}</td>
          <td className="px-4 py-2 text-right">{money(p.buckets['90+'])}</td>
          <td className="px-4 py-2 text-right font-semibold">{money(p.total)}</td>
        </tr>
      ))}
      <tr className="font-semibold">
        <td className="px-4 py-2">Total</td>
        <td className="px-4 py-2 text-right">{money(d.totals.current)}</td>
        <td className="px-4 py-2 text-right">{money(d.totals['1-30'])}</td>
        <td className="px-4 py-2 text-right">{money(d.totals['31-60'])}</td>
        <td className="px-4 py-2 text-right">{money(d.totals['61-90'])}</td>
        <td className="px-4 py-2 text-right">{money(d.totals['90+'])}</td>
        <td className="px-4 py-2 text-right">{money(d.grandTotal)}</td>
      </tr>
    </Table>
  );
}
