import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money, date, formatPhone } from '../lib/format';

export interface PreviewLine {
  name?: string;
  description?: string;
  quantity: string;
  unitPrice: string;
  amount: number;
}

export interface DocumentPreviewProps {
  kind: 'INVOICE' | 'BILL';
  number?: string; // falls back to "DRAFT"
  issueDate?: string;
  dueDate?: string;
  /** "Bill To" (invoice) or "Vendor" (bill) party. */
  party?: { name: string; sub?: string[] } | null;
  lines: PreviewLine[];
  subtotal: number;
  taxTotal: number;
  /** Defaults to the company's base currency when omitted. */
  currency?: string;
  memo?: string;
}

/** Live, document-styled preview of an invoice/bill as it's being built —
 *  mirrors the PDF layout (logo, company header, bill-to, line items, totals)
 *  so what you see while entering data is close to what gets generated/sent. */
export default function DocumentPreview({ kind, number, issueDate, dueDate, party, lines, subtotal, taxTotal, currency, memo }: DocumentPreviewProps) {
  const { companyId } = useAuth();
  const company = useQuery({ queryKey: ['company', companyId], enabled: !!companyId, queryFn: () => api.get('/company') });
  const logo = useQuery({ queryKey: ['company-logo', companyId], enabled: !!companyId, queryFn: () => api.get('/company/logo-url').catch(() => null) });
  const c = company.data ?? {};
  const logoUrl = (logo.data as any)?.url ?? null;
  const curr = currency || c.baseCurrency || 'USD';
  const addrLines = [c.addressLine1, c.addressLine2, [c.city, c.region, c.postalCode].filter(Boolean).join(', '), c.country].filter(Boolean);
  const total = subtotal + taxTotal;
  const hasLines = lines.some((l) => (l.name || l.description) && Number(l.unitPrice) > 0);

  return (
    <div className="sticky top-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-2 text-center text-[10px] font-semibold uppercase tracking-widest text-slate-400">Live preview</div>
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-2">
          {logoUrl && <img src={logoUrl} alt="" className="h-12 w-12 shrink-0 rounded object-contain" />}
          <div>
            <div className="text-lg font-semibold text-emerald-900">{c.legalName || 'Your Company'}</div>
            <div className="text-[11px] leading-tight text-slate-500">
              {[c.email, formatPhone(c.phone), ...addrLines].filter(Boolean).map((l: string, i: number) => <div key={i}>{l}</div>)}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xl font-bold tracking-wide text-emerald-900">{kind}</div>
          <div className="mt-1 text-[11px] text-slate-600">
            <div>{kind === 'INVOICE' ? 'Invoice' : 'Bill'} #: {number || 'DRAFT'}</div>
            {issueDate && <div>Date: {date(issueDate)}</div>}
            {dueDate && <div>Due: {date(dueDate)}</div>}
          </div>
        </div>
      </div>

      <div className="my-3 border-t border-slate-200" />

      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{kind === 'INVOICE' ? 'Bill to' : 'Vendor'}</div>
      {party ? (
        <div className="mt-0.5 text-sm">
          <div className="font-medium text-slate-800">{party.name}</div>
          <div className="text-[11px] text-slate-500">{(party.sub ?? []).map((l, i) => <div key={i}>{l}</div>)}</div>
        </div>
      ) : (
        <div className="mt-0.5 text-sm italic text-slate-300">Select a {kind === 'INVOICE' ? 'customer' : 'vendor'}…</div>
      )}

      <table className="mt-4 w-full text-[11px]">
        <thead>
          <tr className="border-b border-slate-200 text-left text-[10px] font-semibold uppercase tracking-wide text-emerald-900">
            <th className="pb-1 font-semibold">Description</th>
            <th className="pb-1 text-right font-semibold">Qty</th>
            <th className="pb-1 text-right font-semibold">Unit</th>
            <th className="pb-1 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {hasLines ? lines.filter((l) => l.name || l.description || Number(l.unitPrice) > 0).map((l, i) => (
            <tr key={i} className="border-b border-slate-100 align-top">
              <td className="py-1.5 pr-2">
                <div className="font-medium text-slate-800">{l.name || l.description || '—'}</div>
                {l.name && l.description && l.description !== l.name && (
                  <div className="text-[10px] text-slate-400">{l.description}</div>
                )}
              </td>
              <td className="py-1.5 text-right text-slate-600">{l.quantity || '—'}</td>
              <td className="py-1.5 text-right text-slate-600">{money(l.unitPrice || 0, curr)}</td>
              <td className="py-1.5 text-right font-medium text-slate-800">{money(l.amount, curr)}</td>
            </tr>
          )) : (
            <tr><td colSpan={4} className="py-4 text-center italic text-slate-300">Add line items to see them here…</td></tr>
          )}
        </tbody>
      </table>

      <div className="mt-3 flex justify-end">
        <div className="w-40 text-sm">
          <div className="flex justify-between text-slate-500"><span>Subtotal</span><span>{money(subtotal, curr)}</span></div>
          <div className="flex justify-between text-slate-500"><span>Tax</span><span>{money(taxTotal, curr)}</span></div>
          <div className="mt-1 flex justify-between border-t border-slate-200 pt-1 font-semibold text-slate-800"><span>Total</span><span>{money(total, curr)}</span></div>
        </div>
      </div>

      {memo && <div className="mt-4 text-[11px] text-slate-500">Notes: {memo}</div>}
    </div>
  );
}
