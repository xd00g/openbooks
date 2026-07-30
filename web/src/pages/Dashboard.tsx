import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money, startOfYear, today } from '../lib/format';
import { Page, Stat, Card, Empty, BalanceSeam } from '../components/ui';

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

      {/* The signature moment: whether the books balance, stated once, large,
          before any of the detail below it. */}
      <div className="mb-6 border border-rule bg-white p-5">
        {bs.isLoading ? <Muted /> : (
          <>
            <BalanceSeam
              debits={Number(bs.data?.totalAssets ?? 0)}
              credits={Number(bs.data?.totalLiabilitiesAndEquity ?? 0)}
            />
            <div className="tnum mt-4 flex justify-between font-display text-figure font-semibold">
              <span>{money(bs.data?.totalAssets)}</span>
              <span>{money(bs.data?.totalLiabilitiesAndEquity)}</span>
            </div>
            <div className="mt-1 flex justify-between text-xs text-muted">
              <span>Assets</span>
              <span>Liabilities + Equity</span>
            </div>
          </>
        )}
      </div>

      <Card title="Profit & Loss (YTD)">
        {pl.isLoading ? <Muted /> : (
          <dl className="text-sm">
            <Row k="Income" v={money(pl.data?.revenue.total)} />
            <Row k="Cost of goods sold" v={money(pl.data?.costOfGoodsSold.total)} />
            <Row k="Gross profit" v={money(pl.data?.grossProfit)} rule />
            <Row k="Expenses" v={money(pl.data?.expenses.total)} />
            <Row k="Net income" v={money(pl.data?.netIncome)} total />
          </dl>
        )}
      </Card>
    </Page>
  );
}

const Muted = () => <div className="text-sm text-muted">Loading…</div>;

/** A P&L line. `rule` marks a subtotal (single rule above, as on ruled paper);
 *  `total` marks the bottom line (double rule, the bookkeeper's convention). */
function Row({ k, v, rule, total }: { k: string; v: string; rule?: boolean; total?: boolean }) {
  const emphasis = rule || total ? 'font-semibold text-ink' : 'text-muted';
  const border = total ? 'mt-1 border-t-[3px] border-double border-ink pt-1.5' : rule ? 'mt-1 border-t border-rule pt-1.5' : '';
  return (
    <div className={`flex justify-between py-1 ${emphasis} ${border}`}>
      <span>{k}</span><span className="tnum">{v}</span>
    </div>
  );
}
