import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money, date } from '../lib/format';
import { Page, Card, Table, Button, Empty, Modal } from '../components/ui';
import Attachments from '../components/Attachments';

/** Actual-Budget-style account register: pick an account, see its posted ledger
 *  activity with a running balance, and attach receipts to any transaction. */
export default function Registers() {
  const { companyId } = useAuth();
  const key = (k: string) => [k, companyId];
  const [acctId, setAcctId] = useState('');
  const [receiptFor, setReceiptFor] = useState<string | null>(null);

  const accounts = useQuery({ queryKey: key('accounts'), enabled: !!companyId, queryFn: () => api.get('/accounts') });
  const reg = useQuery({
    queryKey: key(`register-${acctId}`),
    enabled: !!companyId && !!acctId,
    queryFn: () => api.get(`/accounts/${acctId}/register`),
  });

  if (!companyId) return <Page title="Account Registers"><Empty>Select a company.</Empty></Page>;

  const bankFirst = [...(accounts.data ?? [])].sort((a: any, b: any) => {
    const rank = (x: any) => (x.subtype === 'bank' || x.subtype === 'credit_card' ? 0 : 1);
    return rank(a) - rank(b) || a.code.localeCompare(b.code);
  });

  return (
    <Page title="Account Registers">
      <Card>
        <div className="flex items-center gap-3">
          <select value={acctId} onChange={(e) => setAcctId(e.target.value)} className="w-96 rounded-md border border-slate-300 px-2 py-1.5 text-sm">
            <option value="">Select an account…</option>
            {bankFirst.map((a: any) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select>
          {reg.data && <span className="text-sm text-slate-500">Balance: <b className="text-slate-800">{money(reg.data.balance)}</b></span>}
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
            {reg.data && reg.data.rows.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-400">No posted activity in this account yet.</td></tr>}
          </Table>
        </div>
      )}

      {receiptFor && (
        <Modal title="Receipts & documents" onClose={() => setReceiptFor(null)}>
          <Attachments entityType="journalEntry" entityId={receiptFor} />
        </Modal>
      )}
    </Page>
  );
}
