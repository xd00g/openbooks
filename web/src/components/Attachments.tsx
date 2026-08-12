import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { date } from '../lib/format';

/**
 * Receipts/documents for any entity. Uploads go directly to object storage via
 * a presigned PUT (the bytes never pass through our API), then we confirm the
 * record. Downloads use a presigned GET.
 */
export default function Attachments({ entityType, entityId }: { entityType: string; entityId: string }) {
  const { companyId } = useAuth();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const key = ['attachments', companyId, entityType, entityId];
  const list = useQuery({
    queryKey: key,
    enabled: !!companyId,
    queryFn: () => api.get(`/attachments?entityType=${entityType}&entityId=${entityId}`),
  });

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setErr('');
    try {
      const { attachmentId, uploadUrl } = await api.post('/attachments/upload-url', {
        entityType,
        entityId,
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
      });
      // Direct PUT to object storage — no auth headers (presigned).
      const put = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'content-type': file.type || 'application/octet-stream' },
      });
      if (!put.ok) throw new Error(`Upload failed (${put.status}).`);
      await api.post(`/attachments/${attachmentId}/confirm`, {});
      qc.invalidateQueries({ queryKey: key });
    } catch (e: any) {
      setErr(e.message || 'Upload failed');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function download(id: string) {
    try {
      const { url } = await api.get(`/attachments/${id}/download-url`);
      window.open(url, '_blank');
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <div>
      {err && <div className="mb-3 rounded-md bg-owed/5 px-3 py-2 text-sm text-owed">{err}</div>}
      <ul className="mb-4 divide-y divide-rule rounded-lg border border-rule">
        {(list.data ?? []).map((a: any) => (
          <li key={a.id} className="flex items-center justify-between px-3 py-2 text-sm">
            <span className="truncate">
              {a.filename}
              <span className="ml-2 text-xs text-muted">{date(a.createdAt)}</span>
            </span>
            <button onClick={() => download(a.id)} className="text-muted hover:text-ink">Download</button>
          </li>
        ))}
        {(list.data ?? []).length === 0 && (
          <li className="px-3 py-3 text-center text-sm text-muted">No files yet.</li>
        )}
      </ul>
      <label className="inline-flex cursor-pointer items-center rounded-md border border-rule px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper">
        {busy ? 'Uploading…' : 'Upload receipt'}
        <input ref={fileRef} type="file" className="hidden" onChange={onPick} disabled={busy} />
      </label>
    </div>
  );
}
