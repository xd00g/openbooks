import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money, startOfYear, today } from '../lib/format';
import { Page, Stat, Card, Empty } from '../components/ui';

export default function Dashboard() {
  const { companyId } = useAuth();

  const bs = useQuery({
    queryKey: ['bs', companyId],
    enabled: !!companyId,
    queryFn: () => api.get(`/reports/balance-sheet?asOf=${today()}`),
  });
  const pl = useQuery({
    queryKey: ['pl', companyId],
    enabled: !!companyId,
    queryFn: () => api.get(`/reports/income-statement?from=${startOfYear()}&to=${today()}`),
  });
  const ar = useQuery({
    queryKey: ['ar', companyId],
    enabled: !!companyId,
    queryFn: () => api.get(`/reports/ar-aging?asOf=${today()}`),
  });
  const ap = useQuery({
    queryKey: ['ap', companyId],
    enabled: !!companyId,
    queryFn: () => api.get(`/reports/ap-aging?asOf=${today()}`),
  });

  if (!companyId) return <Page title="Dashboard"><Empty>Select a company to get started.</Empty></Page>;

  const net = pl.data?.netIncome ?? '0';
  return (
    <Page title="Dashboard">
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Net income (YTD)" value={money(net)} tone={Number(net) < 0 ? 'neg' : 'pos'} />
        <Stat label="Total assets" value={money(bs.data?.totalAssets)} />
        <Stat label="A/R outstanding" value={money(ar.data?.grandTotal)} />
        <Stat label="A/P outstanding" value={money(ap.data?.grandTotal)} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Profit & Loss (YTD)">
          {pl.isLoading ? <Muted /> : (
            <dl className="space-y-1 text-sm">
              <Row k="Income" v={money(pl.data?.revenue.total)} />
              <Row k="Cost of goods sold" v={money(pl.data?.costOfGoodsSold.total)} />
              <Row k="Gross profit" v={money(pl.data?.grossProfit)} bold />
              <Row k="Expenses" v={money(pl.data?.expenses.total)} />
              <Row k="Net income" v={money(pl.data?.netIncome)} bold />
            </dl>
          )}
        </Card>
        <Card title="Balance Sheet">
          {bs.isLoading ? <Muted /> : (
            <dl className="space-y-1 text-sm">
              <Row k="Assets" v={money(bs.data?.totalAssets)} bold />
              <Row k="Liabilities + Equity" v={money(bs.data?.totalLiabilitiesAndEquity)} bold />
              <div className="pt-1 text-xs">
                {bs.data?.balanced
                  ? <span className="text-emerald-600">✓ In balance</span>
                  : <span className="text-red-600">✗ Out of balance</span>}
              </div>
            </dl>
          )}
        </Card>
      </div>
    </Page>
  );
}

const Muted = () => <div className="text-sm text-slate-400">Loading…</div>;
function Row({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-semibold text-slate-800' : 'text-slate-600'}`}>
      <span>{k}</span><span>{v}</span>
    </div>
  );
}
