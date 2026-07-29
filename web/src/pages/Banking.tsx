import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money, date, today } from '../lib/format';
import { Page, Card, Table, Button, Empty, Banner } from '../components/ui';

export default function Banking() {
  const { companyId } = useAuth();
  const qc = useQueryClient();
  const key = (k: string, ...rest: string[]) => [k, companyId, ...rest];
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState<string>('');

  const bankAccounts = useQuery({ queryKey: key('bankAccounts'), enabled: !!companyId, queryFn: () => api.get('/banking/accounts') });
  const glAccounts = useQuery({ queryKey: key('accounts'), enabled: !!companyId, queryFn: () => api.get('/accounts') });
  const bankGl = (glAccounts.data ?? []).filter((a: any) => a.subtype === 'bank' || a.subtype === 'credit_card');

  const accountId = selected || bankAccounts.data?.[0]?.id || '';

  const txns = useQuery({
    queryKey: key('bankTxns', accountId),
    enabled: !!companyId && !!accountId,
    queryFn: () => api.get(`/banking/accounts/${accountId}/transactions`),
  });
  const recs = useQuery({
    queryKey: key('recs', accountId),
    enabled: !!companyId && !!accountId,
    queryFn: () => api.get(`/banking/reconciliations?bankAccountId=${accountId}`),
  });
  const active = (recs.data ?? []).find((r: any) => r.status === 'in_progress');
  const summary = useQuery({
    queryKey: key('recSummary', active?.id ?? ''),
    enabled: !!active,
    queryFn: () => api.get(`/banking/reconciliations/${active.id}/summary`),
  });

  const refreshRecon = () => {
    qc.invalidateQueries({ queryKey: key('bankTxns', accountId) });
    qc.invalidateQueries({ queryKey: key('recs', accountId) });
    if (active) qc.invalidateQueries({ queryKey: key('recSummary', active.id) });
  };

  // Connect / link bank accounts (SimpleFIN or manual GL link)
  const [showConnect, setShowConnect] = useState(false);
  const activeBank = (bankAccounts.data ?? []).find((b: any) => b.id === accountId);
  const onLinked = () => qc.invalidateQueries({ queryKey: key('bankAccounts') });

  // Sync the selected SimpleFIN account
  const syncMut = useMutation({
    mutationFn: () => api.post(`/banking/accounts/${accountId}/sync`, {}),
    onSuccess: () => { refreshRecon(); qc.invalidateQueries({ queryKey: key('bankAccounts') }); },
    onError: (e: any) => setErr(e.message),
  });

  // CSV import
  const [csv, setCsv] = useState('');
  const importCsv = useMutation({
    mutationFn: () => api.post(`/banking/accounts/${accountId}/import`, { format: 'csv', content: csv }),
    onSuccess: () => { setCsv(''); refreshRecon(); },
    onError: (e: any) => setErr(e.message),
  });

  // Start reconciliation
  const [start, setStart] = useState({ statementDate: today(), beginningBalance: '0', endingBalance: '' });
  const startRecon = useMutation({
    mutationFn: () => api.post('/banking/reconciliations', { bankAccountId: accountId, ...start }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key('recs', accountId) }),
    onError: (e: any) => setErr(e.message),
  });

  const toggleClear = (t: any, cleared: boolean) =>
    api.post(`/banking/reconciliations/${active.id}/cleared`, { bankTransactionId: t.id, cleared })
      .then(refreshRecon).catch((e) => setErr(e.message));

  const complete = () =>
    api.post(`/banking/reconciliations/${active.id}/complete`)
      .then(refreshRecon).catch((e) => setErr(e.message));

  if (!companyId) return <Page title="Banking"><Empty>Select a company.</Empty></Page>;

  return (
    <Page title="Banking">
      <Banner text={err} />

      {(bankAccounts.data ?? []).length === 0 ? (
        <ConnectBank bankGl={bankGl} onLinked={onLinked} onError={setErr} />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-500">Account:</span>
            <select value={accountId} onChange={(e) => setSelected(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1 text-sm">
              {(bankAccounts.data ?? []).map((b: any) => (
                <option key={b.id} value={b.id}>{b.account.code} {b.account.name}{b.mask ? ` ••${b.mask}` : ''}</option>
              ))}
            </select>
            {activeBank?.provider === 'simplefin' && (
              <Button variant="ghost" onClick={() => syncMut.mutate()} disabled={syncMut.isPending}>
                {syncMut.isPending ? 'Syncing…' : 'Sync now'}
              </Button>
            )}
            <Button variant="ghost" onClick={() => setShowConnect((v) => !v)}>
              {showConnect ? 'Close' : 'Connect account'}
            </Button>
          </div>
          {showConnect && (
            <div className="mb-6">
              <ConnectBank bankGl={bankGl} onLinked={() => { onLinked(); setShowConnect(false); }} onError={setErr} />
            </div>
          )}

          <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title="Import statement (CSV)">
              <textarea
                value={csv}
                onChange={(e) => setCsv(e.target.value)}
                placeholder={'Date,Amount,Description\n2026-07-01,100.00,Deposit\n2026-07-02,-40.00,Coffee'}
                className="h-28 w-full rounded-md border border-slate-300 px-2 py-1 font-mono text-xs"
              />
              <div className="mt-2"><Button onClick={() => importCsv.mutate()} disabled={!csv.trim()}>Import</Button></div>
            </Card>

            <Card title="Reconciliation">
              {active ? (
                <div className="text-sm">
                  <div className="mb-2 text-slate-600">Statement ending <b>{money(active.endingBalance)}</b> · {date(active.statementDate)}</div>
                  {summary.data && (
                    <dl className="space-y-1">
                      <div className="flex justify-between"><span className="text-slate-500">Beginning</span><span>{money(summary.data.beginningBalance)}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Cleared ({summary.data.clearedCount})</span><span>{money(summary.data.clearedNet)}</span></div>
                      <div className="flex justify-between font-medium"><span>Computed ending</span><span>{money(summary.data.computedEnding)}</span></div>
                      <div className={`flex justify-between font-semibold ${summary.data.balanced ? 'text-emerald-600' : 'text-red-600'}`}>
                        <span>Difference</span><span>{money(summary.data.difference)}</span>
                      </div>
                    </dl>
                  )}
                  <div className="mt-3">
                    <Button onClick={complete} disabled={!summary.data?.balanced}>Complete &amp; lock</Button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <label className="text-xs text-slate-500">Statement date<input type="date" value={start.statementDate} onChange={(e) => setStart({ ...start, statementDate: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1" /></label>
                  <div />
                  <label className="text-xs text-slate-500">Beginning balance<input value={start.beginningBalance} onChange={(e) => setStart({ ...start, beginningBalance: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1" /></label>
                  <label className="text-xs text-slate-500">Ending balance<input value={start.endingBalance} onChange={(e) => setStart({ ...start, endingBalance: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1" /></label>
                  <div className="col-span-2 mt-1"><Button onClick={() => startRecon.mutate()} disabled={!start.endingBalance}>Start reconciliation</Button></div>
                </div>
              )}
            </Card>
          </div>

          <Table head={active ? ['Cleared', 'Date', 'Description', 'Amount', 'Status'] : ['Date', 'Description', 'Amount', 'Status']}>
            {(txns.data ?? []).map((t: any) => {
              const clearedHere = active && t.reconciliationId === active.id;
              const lockedElsewhere = t.reconciliationId && (!active || t.reconciliationId !== active.id);
              return (
                <tr key={t.id}>
                  {active && (
                    <td className="px-4 py-2">
                      <input type="checkbox" checked={!!clearedHere} disabled={!!lockedElsewhere} onChange={(e) => toggleClear(t, e.target.checked)} />
                    </td>
                  )}
                  <td className="px-4 py-2">{date(t.postedDate)}</td>
                  <td className="px-4 py-2">{t.description}</td>
                  <td className={`px-4 py-2 text-right ${Number(t.amount) < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{money(t.amount)}</td>
                  <td className="px-4 py-2 capitalize text-slate-500">{t.status}</td>
                </tr>
              );
            })}
            {(txns.data ?? []).length === 0 && (
              <tr><td colSpan={active ? 5 : 4} className="px-4 py-6 text-center text-sm text-slate-400">No transactions. Import a statement above.</td></tr>
            )}
          </Table>
        </>
      )}
    </Page>
  );
}

/**
 * Connect a bank account either automatically via SimpleFIN (paste a setup
 * token, then map each discovered account to a GL account) or by linking a GL
 * account manually for CSV/OFX imports.
 */
function ConnectBank({
  bankGl,
  onLinked,
  onError,
}: {
  bankGl: any[];
  onLinked: () => void;
  onError: (m: string) => void;
}) {
  const [mode, setMode] = useState<'simplefin' | 'manual'>('simplefin');

  // SimpleFIN
  const [token, setToken] = useState('');
  const [discovered, setDiscovered] = useState<any[] | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [linked, setLinked] = useState<Record<string, boolean>>({});
  const claim = useMutation({
    mutationFn: () => api.post('/banking/accounts/simplefin/claim', { setupToken: token }),
    onSuccess: (r: any) => { setDiscovered(r.accounts ?? []); },
    onError: (e: any) => onError(e.message),
  });
  const link = useMutation({
    mutationFn: (acct: any) =>
      api.post('/banking/accounts/simplefin/link', {
        externalAccountId: acct.id,
        accountId: mapping[acct.id],
        institution: acct.org,
        mask: acct.name?.match(/(\d{4})\D*$/)?.[1],
      }),
    onSuccess: (_r, acct: any) => { setLinked((m) => ({ ...m, [acct.id]: true })); onLinked(); },
    onError: (e: any) => onError(e.message),
  });

  // Manual
  const [newBank, setNewBank] = useState({ accountId: '', institution: '', mask: '' });
  const createBank = useMutation({
    mutationFn: () => api.post('/banking/accounts', newBank),
    onSuccess: () => { setNewBank({ accountId: '', institution: '', mask: '' }); onLinked(); },
    onError: (e: any) => onError(e.message),
  });

  return (
    <Card title="Connect a bank account">
      <div className="mb-4 flex gap-2">
        {(['simplefin', 'manual'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${mode === m ? 'bg-slate-900 text-white' : 'border border-slate-300 text-slate-700 hover:bg-slate-50'}`}
          >
            {m === 'simplefin' ? 'SimpleFIN (automatic)' : 'Manual (CSV / OFX)'}
          </button>
        ))}
      </div>

      {mode === 'simplefin' ? (
        <div className="text-sm">
          <p className="mb-2 text-slate-500">
            Get a setup token from your bank via{' '}
            <a href="https://bridge.simplefin.org/" target="_blank" rel="noreferrer" className="text-slate-700 underline">SimpleFIN Bridge</a>, then paste it here.
          </p>
          <textarea
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste SimpleFIN setup token…"
            className="h-20 w-full rounded-md border border-slate-300 px-2 py-1 font-mono text-xs"
          />
          <div className="mt-2">
            <Button onClick={() => claim.mutate()} disabled={!token.trim() || claim.isPending}>
              {claim.isPending ? 'Connecting…' : 'Connect'}
            </Button>
          </div>

          {discovered && discovered.length === 0 && (
            <p className="mt-3 text-slate-400">No accounts found for that token.</p>
          )}
          {discovered && discovered.length > 0 && (
            <div className="mt-4 space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Map each account to a GL account</div>
              {discovered.map((acct: any) => (
                <div key={acct.id} className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 p-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-slate-700">{acct.name}</div>
                    <div className="text-xs text-slate-400">{acct.org}{acct.balance ? ` · balance ${acct.balance} ${acct.currency ?? ''}` : ''}</div>
                  </div>
                  {linked[acct.id] ? (
                    <span className="text-xs font-medium text-emerald-600">✓ Linked</span>
                  ) : (
                    <>
                      <select
                        value={mapping[acct.id] ?? ''}
                        onChange={(e) => setMapping((m) => ({ ...m, [acct.id]: e.target.value }))}
                        className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                      >
                        <option value="">GL account…</option>
                        {bankGl.map((a: any) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                      </select>
                      <Button onClick={() => link.mutate(acct)} disabled={!mapping[acct.id] || link.isPending}>Link</Button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 text-sm">
          <select value={newBank.accountId} onChange={(e) => setNewBank({ ...newBank, accountId: e.target.value })} className="col-span-2 rounded-md border border-slate-300 px-2 py-1">
            <option value="">GL bank/credit-card account…</option>
            {bankGl.map((a: any) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
          </select>
          <input value={newBank.institution} onChange={(e) => setNewBank({ ...newBank, institution: e.target.value })} placeholder="Institution" className="rounded-md border border-slate-300 px-2 py-1" />
          <input value={newBank.mask} onChange={(e) => setNewBank({ ...newBank, mask: e.target.value })} placeholder="Last 4" className="rounded-md border border-slate-300 px-2 py-1" />
          <div className="col-span-2"><Button onClick={() => createBank.mutate()} disabled={!newBank.accountId}>Link account</Button></div>
        </div>
      )}
    </Card>
  );
}
