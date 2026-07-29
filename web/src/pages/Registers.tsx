import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money, date, today } from '../lib/format';
import { Page, Card, Table, Button, Empty, Modal } from '../components/ui';
import Attachments from '../components/Attachments';

const MONEY_SUBTYPES = ['bank', 'credit_card', 'undeposited_funds'];

/** Actual-Budget-style register: pick a bank/credit-card account, see its posted
 *  activity with a running balance, add manual transactions, and attach receipts. */
export default function Registers() {
  const { companyId } = useAuth();
  const qc = useQueryClient();
  const key = (k: string) => [k, companyId];
  const [acctId, setAcctId] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [receiptFor, setReceiptFor] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const emptyTx = { date: today(), direction: 'outflow', amount: '', categoryAccountId: '', memo: '' };
  const [tx, setTx] = useState<typeof emptyTx | null>(null);

  const accounts = useQuery({ queryKey: key('accounts'), enabled: !!companyId, queryFn: () => api.get('/accounts') });
  const regKey = key(`register-${acctId}`);
  const reg = useQuery({ queryKey: regKey, enabled: !!companyId && !!acctId, queryFn: () => api.get(`/accounts/${acctId}/register`) });

  const addTx = useMutation({
    mutationFn: () => api.post(`/accounts/${acctId}/transactions`, tx),
    onSuccess: () => { setTx(null); qc.invalidateQueries({ queryKey: regKey }); },
    onError: (e: any) => setErr(e.message),
  });

  const [imp, setImp] = useState<{ content: string; categoryAccountId: string } | null>(null);
  const importTx = useMutation({
    mutationFn: () => api.post(`/accounts/${acctId}/import`, imp),
    onSuccess: (r: any) => { setImp(null); setErr(`✓ Imported ${r.created} of ${r.total} transactions`); qc.invalidateQueries({ queryKey: regKey }); },
    onError: (e: any) => setErr(e.message),
  });

  if (!companyId) return <Page title="Account Registers"><Empty>Select a company.</Empty></Page>;

  const all = accounts.data ?? [];
  const moneyAccounts = all.filter((a: any) => MONEY_SUBTYPES.includes(a.subtype));
  const options = (showAll ? all : moneyAccounts)
    .slice()
    .sort((a: any, b: any) => a.code.localeCompare(b.code));

  return (
    <Page title="Account Registers">
      {err && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <select value={acctId} onChange={(e) => setAcctId(e.target.value)} className="w-80 rounded-md border border-slate-300 px-2 py-1.5 text-sm">
            <option value="">Select an account…</option>
            {options.map((a: any) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            Show all accounts (not just bank / credit card)
          </label>
          {reg.data && <span className="ml-auto text-sm text-slate-500">Balance: <b className="text-slate-800">{money(reg.data.balance)}</b></span>}
          {acctId && <Button variant="ghost" onClick={() => { setErr(''); setImp({ content: '', categoryAccountId: '' }); }}>Import CSV/OFX</Button>}
          {acctId && <Button onClick={() => { setErr(''); setTx(emptyTx); }}>Add transaction</Button>}
        </div>
      </Card>

      {acctId && (
        <div className="mt-4">
          <Table head={['Date', 'Description', 'Source', 'Debit', 'Credit', 'Balance', '']}>
            {(reg.data?.rows ?? []).map((r: any) => (
              <tr key={r.id}>
                <td className="px-4 py-2 whitespace-nowrap">{date(r.date)}</td>
                <td className="px-4 py-2">{r.memo || '—'}</td>
                <td className="px-4 py-2 text-xs capitalize text-slate-400">{String(r.source).replace(/_/g, ' ')}</td>
                <td className="px-4 py-2 text-right">{Number(r.debit) ? money(r.debit) : ''}</td>
                <td className="px-4 py-2 text-right">{Number(r.credit) ? money(r.credit) : ''}</td>
                <td className="px-4 py-2 text-right font-medium">{money(r.balance)}</td>
                <td className="px-4 py-2 text-right"><Button variant="ghost" onClick={() => setReceiptFor(r.journalEntryId)}>Receipt</Button></td>
              </tr>
            ))}
            {reg.data && reg.data.rows.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-400">No posted activity yet — add a transaction to get started.</td></tr>}
          </Table>
        </div>
      )}

      {tx && (
        <Modal title="Add transaction" onClose={() => setTx(null)}>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <label className="text-xs text-slate-500">Date<input type="date" value={tx.date} onChange={(e) => setTx({ ...tx, date: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1" /></label>
            <label className="text-xs text-slate-500">Direction
              <select value={tx.direction} onChange={(e) => setTx({ ...tx, direction: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1">
                <option value="outflow">Money out (payment/charge)</option>
                <option value="inflow">Money in (deposit)</option>
              </select>
            </label>
            <label className="text-xs text-slate-500">Amount<input value={tx.amount} onChange={(e) => setTx({ ...tx, amount: e.target.value })} placeholder="0.00" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-right" /></label>
            <label className="text-xs text-slate-500">Category account
              <select value={tx.categoryAccountId} onChange={(e) => setTx({ ...tx, categoryAccountId: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1">
                <option value="">Select category…</option>
                {all.filter((a: any) => a.id !== acctId).map((a: any) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
              </select>
            </label>
            <label className="col-span-2 text-xs text-slate-500">Memo<input value={tx.memo} onChange={(e) => setTx({ ...tx, memo: e.target.value })} placeholder="Description" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1" /></label>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setTx(null)}>Cancel</Button>
            <Button onClick={() => addTx.mutate()} disabled={!tx.amount || !tx.categoryAccountId}>Add</Button>
          </div>
        </Modal>
      )}

      {imp && (
        <Modal title="Import transactions (CSV or OFX/QFX)" onClose={() => setImp(null)}>
          <p className="mb-2 text-xs text-slate-500">Upload or paste a bank / credit-card export. CSV needs <code>date</code>, <code>amount</code> (signed) and <code>description</code> columns — separate debit/credit columns work too. Money in = deposit; money out = payment.</p>
          <input type="file" accept=".csv,.ofx,.qfx,.txt" onChange={(e) => { const f = e.target.files?.[0]; if (f) { const r = new FileReader(); r.onload = () => setImp((s) => (s ? { ...s, content: String(r.result ?? '') } : s)); r.readAsText(f); } }} className="mb-2 text-sm" />
          <textarea value={imp.content} onChange={(e) => setImp({ ...imp, content: e.target.value })} placeholder="…or paste CSV / OFX here" className="h-28 w-full rounded-md border border-slate-300 px-2 py-1 font-mono text-xs" />
          <label className="mt-2 block text-xs text-slate-500">Category account for these transactions (reclassify later as needed)
            <select value={imp.categoryAccountId} onChange={(e) => setImp({ ...imp, categoryAccountId: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm">
              <option value="">Select category…</option>
              {all.filter((a: any) => a.id !== acctId).map((a: any) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </select>
          </label>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setImp(null)}>Cancel</Button>
            <Button onClick={() => importTx.mutate()} disabled={!imp.content.trim() || !imp.categoryAccountId || importTx.isPending}>{importTx.isPending ? 'Importing…' : 'Import'}</Button>
          </div>
        </Modal>
      )}

      {receiptFor && (
        <Modal title="Receipts & documents" onClose={() => setReceiptFor(null)}>
          <Attachments entityType="journalEntry" entityId={receiptFor} />
        </Modal>
      )}
    </Page>
  );
}
