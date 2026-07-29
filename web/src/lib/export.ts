/**
 * Client-side export helpers. CSV is generated in-browser from the report JSON
 * so no server round-trip is needed. PDF uses the browser's print dialog (a
 * dedicated print stylesheet lives in index.css). A server-rendered PDF is a
 * planned follow-up for pixel-perfect, headless output.
 */

function escapeCsv(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map(escapeCsv).join(',')).join('\r\n');
}

export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Flatten a report payload into CSV rows keyed by report type. */
export function reportToRows(tab: string, d: any): (string | number)[][] {
  switch (tab) {
    case 'trial-balance': {
      const rows: (string | number)[][] = [['Code', 'Account', 'Debit', 'Credit']];
      for (const l of d.lines ?? []) rows.push([l.code, l.name, l.debit ?? 0, l.credit ?? 0]);
      rows.push(['', 'Totals', d.totalDebit ?? 0, d.totalCredit ?? 0]);
      return rows;
    }
    case 'income-statement': {
      const rows: (string | number)[][] = [['Section', 'Account', 'Amount']];
      const section = (title: string, s: any) => {
        for (const l of s?.lines ?? []) rows.push([title, l.name, l.amount ?? 0]);
        rows.push([title, `Total ${title}`, s?.total ?? 0]);
      };
      section('Income', d.revenue);
      section('Cost of Goods Sold', d.costOfGoodsSold);
      rows.push(['', 'Gross profit', d.grossProfit ?? 0]);
      section('Expenses', d.expenses);
      rows.push(['', 'Net income', d.netIncome ?? 0]);
      return rows;
    }
    case 'balance-sheet': {
      const rows: (string | number)[][] = [['Section', 'Account', 'Amount']];
      const section = (title: string, s: any) => {
        for (const l of s?.lines ?? []) rows.push([title, l.name, l.amount ?? 0]);
        rows.push([title, `Total ${title}`, s?.total ?? 0]);
      };
      section('Assets', d.assets);
      section('Liabilities', d.liabilities);
      section('Equity', d.equity);
      return rows;
    }
    case 'ar-aging':
    case 'ap-aging': {
      const label = d.kind === 'ar' ? 'Customer' : 'Vendor';
      const rows: (string | number)[][] = [[label, 'Current', '1-30', '31-60', '61-90', '90+', 'Total']];
      for (const p of d.parties ?? []) {
        rows.push([
          p.party,
          p.buckets.current, p.buckets['1-30'], p.buckets['31-60'],
          p.buckets['61-90'], p.buckets['90+'], p.total,
        ]);
      }
      const t = d.totals ?? {};
      rows.push(['Total', t.current, t['1-30'], t['31-60'], t['61-90'], t['90+'], d.grandTotal]);
      return rows;
    }
    default:
      return [];
  }
}
