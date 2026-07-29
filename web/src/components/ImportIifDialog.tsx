import { useRef, useState } from 'react';
import { api } from '../lib/api';
import { Modal, Button } from './ui';

/**
 * QuickBooks Desktop IIF importer. Upload or paste an IIF export, preview what
 * will be created, pick which entity types to import, then commit. Existing
 * accounts/customers/vendors (matched by name) are skipped, so re-running is safe.
 */
export default function ImportIifDialog({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [content, setContent] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [sel, setSel] = useState({ accounts: true, customers: true, vendors: true });
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const onFile = (f: File) => {
    const r = new FileReader();
    r.onload = () => { setContent(String(r.result ?? '')); setPreview(null); setResult(null); };
    r.readAsText(f);
  };

  const run = async (fn: () => Promise<any>) => {
    setBusy(true); setErr('');
    try { return await fn(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const doPreview = () => run(async () => setPreview(await api.post('/import/iif/preview', { content })));
  const doCommit = () => run(async () => {
    const res = await api.post('/import/iif/commit', { content, ...sel });
    setResult(res); onImported();
  });

  return (
    <Modal title="Import from QuickBooks (IIF)" onClose={onClose}>
      {err && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      {result ? (
        <div className="text-sm">
          <p className="mb-3 font-medium text-emerald-700">Import complete.</p>
          <ul className="space-y-1 text-slate-600">
            <li>Accounts: {result.accounts.created} created, {result.accounts.skipped} skipped</li>
            <li>Customers: {result.customers.created} created, {result.customers.skipped} skipped</li>
            <li>Vendors: {result.vendors.created} created, {result.vendors.skipped} skipped</li>
          </ul>
          {result.warnings?.length > 0 && (
            <div className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {result.warnings.map((w: string, i: number) => <div key={i}>{w}</div>)}
            </div>
          )}
          <div className="mt-5 flex justify-end"><Button onClick={onClose}>Done</Button></div>
        </div>
      ) : (
        <div className="text-sm">
          <p className="mb-2 text-slate-500">
            In QuickBooks Desktop: <b>File → Utilities → Export → Lists to IIF Files</b>, then upload the file here.
          </p>
          <div className="mb-2 flex items-center gap-2">
            <input ref={fileRef} type="file" accept=".iif,.txt,text/plain" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
            <Button variant="ghost" onClick={() => fileRef.current?.click()}>Choose .iif file</Button>
            <span className="text-xs text-slate-400">or paste below</span>
          </div>
          <textarea
            value={content}
            onChange={(e) => { setContent(e.target.value); setPreview(null); }}
            placeholder={'!ACCNT\tNAME\tACCNTTYPE\tACCNUM\nACCNT\tChecking\tBANK\t1000'}
            className="h-28 w-full rounded-md border border-slate-300 px-2 py-1 font-mono text-xs"
          />

          {preview && (
            <div className="mt-3 rounded-md border border-slate-200 p-3">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Found in file</div>
              <div className="space-y-1">
                {[
                  { k: 'accounts', label: `Accounts (${preview.counts.accounts})` },
                  { k: 'customers', label: `Customers (${preview.counts.customers})` },
                  { k: 'vendors', label: `Vendors (${preview.counts.vendors})` },
                ].map((row) => (
                  <label key={row.k} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={(sel as any)[row.k]}
                      disabled={(preview.counts as any)[row.k] === 0}
                      onChange={(e) => setSel({ ...sel, [row.k]: e.target.checked })}
                    />
                    <span className={(preview.counts as any)[row.k] === 0 ? 'text-slate-300' : ''}>{row.label}</span>
                  </label>
                ))}
              </div>
              {preview.warnings?.length > 0 && (
                <div className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  {preview.warnings.slice(0, 8).map((w: string, i: number) => <div key={i}>{w}</div>)}
                  {preview.warnings.length > 8 && <div>…and {preview.warnings.length - 8} more.</div>}
                </div>
              )}
            </div>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            {preview ? (
              <Button onClick={doCommit} disabled={busy || (!sel.accounts && !sel.customers && !sel.vendors)}>
                {busy ? 'Importing…' : 'Import selected'}
              </Button>
            ) : (
              <Button onClick={doPreview} disabled={busy || !content.trim()}>
                {busy ? 'Reading…' : 'Preview'}
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
