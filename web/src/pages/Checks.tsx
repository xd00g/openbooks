import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money, date } from '../lib/format';
import { Page, Card, Table, Button, Empty, Banner, Modal } from '../components/ui';

/** Print checks: queue bills marked "print check later" against a bank account,
 *  hand a PDF to the printer, then confirm the run committed the check numbers
 *  (or report a misprint so the failed numbers requeue). History lists what has
 *  printed, with void for mistakes. */
export default function Checks() {
  const { companyId } = useAuth();
  const qc = useQueryClient();
  const [bankAccountId, setBankAccountId] = useState('');
  const [startNumber, setStartNumber] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [voidFor, setVoidFor] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [misprintOpen, setMisprintOpen] = useState(false);
  const [misprintNumber, setMisprintNumber] = useState('');
  const [offsetX, setOffsetX] = useState('0');
  const [offsetY, setOffsetY] = useState('0');

  const banks = useQuery({
    queryKey: ['bank-accounts', companyId],
    enabled: !!companyId,
    queryFn: () => api.get('/banking/accounts'),
  });

  const selectedBank = (banks.data ?? []).find((b: any) => b.id === bankAccountId);
  useEffect(() => {
    setOffsetX(String(selectedBank?.printOffsetX ?? 0));
    setOffsetY(String(selectedBank?.printOffsetY ?? 0));
  }, [selectedBank?.id]);

  const clampOffset = (v: string) => {
    const n = Number(v.replace(/[^-\d]/g, ''));
    if (!Number.isFinite(n)) return 0;
    return Math.max(-200, Math.min(200, Math.trunc(n)));
  };

  const saveOffsets = useMutation({
    mutationFn: () =>
      api.post('/checks/offsets', {
        bankAccountId,
        printOffsetX: clampOffset(offsetX),
        printOffsetY: clampOffset(offsetY),
      }),
    onSuccess: () => {
      setErr('✓ Alignment offsets saved.');
      qc.invalidateQueries({ queryKey: ['bank-accounts'] });
    },
    onError: (e: any) => setErr(e.message),
  });

  const queue = useQuery({
    queryKey: ['check-queue', companyId, bankAccountId],
    enabled: !!companyId && !!bankAccountId,
    queryFn: () => api.get(`/checks/queue?bankAccountId=${bankAccountId}`),
  });

  const history = useQuery({
    queryKey: ['check-history', companyId, bankAccountId],
    enabled: !!companyId && !!bankAccountId,
    queryFn: () => api.get(`/checks/history?bankAccountId=${bankAccountId}`),
  });

  const print = useMutation({
    mutationFn: () =>
      api.post('/checks/print', {
        bankAccountId,
        startNumber: Number(startNumber),
        checkIds: selected,
      }),
    onSuccess: async (r: any) => {
      setBatchId(r.printBatchId);
      setSelected([]);
      setErr('');
      qc.invalidateQueries({ queryKey: ['check-queue'] });
      const url = await api.blobUrl(`/checks/print/${r.printBatchId}/pdf`);
      window.open(url, '_blank');
    },
    onError: (e: any) => setErr(e.message),
  });

  const confirm = useMutation({
    mutationFn: (body: { ok: boolean; reprintFromNumber?: number }) =>
      api.post(`/checks/print/${batchId}/confirm`, body),
    onSuccess: (r: any) => {
      setBatchId(null);
      setErr(
        r.alreadyHandled
          ? '✓ This batch was already confirmed.'
          : r.requeued > 0
            ? `✓ ${r.committed} committed, ${r.requeued} returned to the queue to reprint.`
            : `✓ ${r.committed} checks committed.`,
      );
      qc.invalidateQueries({ queryKey: ['check-queue'] });
      qc.invalidateQueries({ queryKey: ['check-history'] });
    },
    onError: (e: any) => setErr(e.message),
  });

  const voidCheck = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/checks/${id}/void`, { reason }),
    onSuccess: () => {
      setErr('✓ Check voided and the payment reversed.');
      qc.invalidateQueries({ queryKey: ['check-history'] });
    },
    onError: (e: any) => setErr(e.message),
  });

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  if (!companyId) {
    return <Page title="Print checks"><Empty>Select a company to get started.</Empty></Page>;
  }

  const rows = queue.data ?? [];

  return (
    <Page title="Print checks">
      <Banner text={err} />

      <div className="mb-6 flex flex-wrap items-end gap-3">
        <label className="text-xs text-muted">Bank account
          <select
            value={bankAccountId}
            onChange={(e) => { setBankAccountId(e.target.value); setSelected([]); }}
            className="mt-1 block w-72"
          >
            <option value="">Select…</option>
            {(banks.data ?? []).map((b: any) => (
              <option key={b.id} value={b.id}>
                {b.account?.code} {b.account?.name}
                {b.mask ? ` ••${b.mask}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted">Starting check number
          <input
            value={startNumber}
            onChange={(e) => setStartNumber(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
            placeholder="1001"
            className="mt-1 block w-32 rounded-md border border-rule px-2 py-1 font-mono"
          />
        </label>
        <Button
          onClick={() => print.mutate()}
          disabled={!bankAccountId || !startNumber || selected.length === 0 || print.isPending}
        >
          Print {selected.length > 0 ? `${selected.length} ` : ''}checks
        </Button>
        <Button
          variant="ghost"
          onClick={() =>
            api.blobUrl(`/checks/alignment-test?bankAccountId=${bankAccountId}`)
              .then((u) => window.open(u, '_blank'))
              .catch((e) => setErr(e.message))
          }
          disabled={!bankAccountId}
        >
          Alignment test page
        </Button>
        <label className="text-xs text-muted">Offset X (hundredths of an inch)
          <input
            value={offsetX}
            onChange={(e) => setOffsetX(e.target.value.replace(/[^-\d]/g, ''))}
            inputMode="numeric"
            className="mt-1 block w-24 rounded-md border border-rule px-2 py-1 font-mono"
            disabled={!bankAccountId}
          />
        </label>
        <label className="text-xs text-muted">Offset Y (hundredths of an inch)
          <input
            value={offsetY}
            onChange={(e) => setOffsetY(e.target.value.replace(/[^-\d]/g, ''))}
            inputMode="numeric"
            className="mt-1 block w-24 rounded-md border border-rule px-2 py-1 font-mono"
            disabled={!bankAccountId}
          />
        </label>
        <Button
          variant="ghost"
          onClick={() => saveOffsets.mutate()}
          disabled={!bankAccountId || saveOffsets.isPending}
        >
          Save alignment
        </Button>
      </div>

      {batchId && (
        <Card title="Did the checks print correctly?">
          <p className="mb-3 text-sm">
            Confirm to commit these numbers. If the printer jammed, report the first
            check number that failed — those checks return to the queue and reprint
            with new numbers.
          </p>
          <div className="flex gap-2">
            <Button onClick={() => confirm.mutate({ ok: true })} disabled={confirm.isPending}>
              Yes, they printed
            </Button>
            <Button
              variant="ghost"
              onClick={() => { setMisprintNumber(''); setMisprintOpen(true); }}
              disabled={confirm.isPending}
            >
              Report a misprint
            </Button>
          </div>
        </Card>
      )}

      <div className="mt-6">
        {rows.length === 0 ? (
          <Empty>
            {bankAccountId
              ? 'Nothing queued. Pay a bill with "print check later" to add one.'
              : 'Select a bank account to see its check queue.'}
          </Empty>
        ) : (
          <Table head={['', 'Payee', 'Date', 'Memo', 'Amount']}>
            {rows.map((c: any) => (
              <tr key={c.id}>
                <td className="px-4 py-2">
                  <input
                    type="checkbox"
                    checked={selected.includes(c.id)}
                    onChange={() => toggle(c.id)}
                  />
                </td>
                <td className="px-4 py-2">{c.payeeName}</td>
                <td className="px-4 py-2">{date(c.checkDate)}</td>
                <td className="px-4 py-2">{c.memo ?? ''}</td>
                <td className="px-4 py-2 text-right tnum">{money(c.amount)}</td>
              </tr>
            ))}
          </Table>
        )}
      </div>

      <div className="mt-8">
        <h2 className="mb-3 font-display text-eyebrow font-semibold uppercase text-muted">History</h2>
        {(history.data ?? []).length === 0 ? (
          <Empty>No checks printed yet.</Empty>
        ) : (
          <Table head={['Number', 'Payee', 'Date', 'Amount', 'Status', '']}>
            {(history.data ?? []).map((c: any) => (
              <tr key={c.id}>
                <td className="px-4 py-2 font-mono tnum">{c.checkNumber}</td>
                <td className="px-4 py-2">{c.payeeName}</td>
                <td className="px-4 py-2">{date(c.checkDate)}</td>
                <td className="px-4 py-2 text-right tnum">{money(c.amount)}</td>
                <td className="px-4 py-2">
                  {c.status === 'voided' ? `Voided (${c.voidReason ?? ''})` : 'Printed'}
                </td>
                <td className="px-4 py-2">
                  {c.status === 'printed' && (
                    <button
                      onClick={() => { setVoidReason(''); setVoidFor(c.id); }}
                      className="text-xs underline"
                    >
                      Void
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </div>

      {misprintOpen && (
        <Modal title="Report a misprint" onClose={() => setMisprintOpen(false)}>
          <label className="text-xs text-muted">First check number that failed to print
            <input
              value={misprintNumber}
              onChange={(e) => setMisprintNumber(e.target.value.replace(/\D/g, ''))}
              inputMode="numeric"
              placeholder="1001"
              autoFocus
              className="mt-1 block w-full rounded-md border border-rule px-2 py-1 font-mono"
            />
          </label>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setMisprintOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                setMisprintOpen(false);
                confirm.mutate({ ok: false, reprintFromNumber: Number(misprintNumber) });
              }}
              disabled={!misprintNumber || confirm.isPending}
            >
              Report misprint
            </Button>
          </div>
        </Modal>
      )}

      {voidFor && (
        <Modal title="Void this check" onClose={() => setVoidFor(null)}>
          <label className="text-xs text-muted">Reason for voiding this check
            <input
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="e.g. printed with wrong amount"
              autoFocus
              className="mt-1 block w-full rounded-md border border-rule px-2 py-1"
            />
          </label>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setVoidFor(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                const id = voidFor;
                const reason = voidReason.trim();
                setVoidFor(null);
                if (id && reason) voidCheck.mutate({ id, reason });
              }}
              disabled={!voidReason.trim() || voidCheck.isPending}
            >
              Void check
            </Button>
          </div>
        </Modal>
      )}
    </Page>
  );
}
