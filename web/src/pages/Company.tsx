import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { applyTheme, DEFAULT_THEME, THEME_FIELDS, type Theme } from '../lib/theme';
import { Page, Card, Button, Empty, Banner } from '../components/ui';
import { formatPhone } from '../lib/format';

const FIELDS: { key: string; label: string; type?: string }[] = [
  { key: 'legalName', label: 'Legal name' },
  { key: 'dba', label: 'DBA' },
  { key: 'ein', label: 'EIN / Tax ID' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'phone', label: 'Phone' },
  { key: 'addressLine1', label: 'Address line 1' },
  { key: 'addressLine2', label: 'Address line 2' },
  { key: 'city', label: 'City' },
  { key: 'region', label: 'State / Region' },
  { key: 'postalCode', label: 'Postal code' },
  { key: 'country', label: 'Country' },
  { key: 'baseCurrency', label: 'Base currency' },
  { key: 'fiscalYearStartMonth', label: 'Fiscal year start month (1-12)', type: 'number' },
];

export default function Company() {
  const { companyId, can } = useAuth();
  const qc = useQueryClient();
  const editable = can('company:manage');
  const [form, setForm] = useState<Record<string, any>>({});
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');

  const q = useQuery({
    queryKey: ['company', companyId],
    enabled: !!companyId,
    queryFn: () => api.get('/company'),
  });

  useEffect(() => { if (q.data) setForm(q.data); }, [q.data]);

  const save = useMutation({
    mutationFn: () => {
      const payload: Record<string, any> = {};
      for (const f of FIELDS) payload[f.key] = f.type === 'number' ? Number(form[f.key]) : form[f.key];
      return api.patch('/company', payload);
    },
    onSuccess: () => { setSaved(true); setErr(''); qc.invalidateQueries({ queryKey: ['company', companyId] }); setTimeout(() => setSaved(false), 2000); },
    onError: (e: any) => setErr(e.message),
  });

  if (!companyId) return <Page title="Company"><Empty>Select a company.</Empty></Page>;

  return (
    <Page title="Company" actions={editable ? <Button onClick={() => save.mutate()}>{saved ? 'Saved ✓' : 'Save changes'}</Button> : undefined}>
      <Banner text={err} />
      {!editable && <div className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">You have read-only access to company settings.</div>}
      <Card title="Company profile">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <label key={f.key} className="text-sm">
              <span className="mb-1 block font-medium text-slate-600">{f.label}</span>
              <input
                type={f.key === 'phone' ? 'tel' : f.type ?? 'text'}
                value={form[f.key] ?? ''}
                disabled={!editable}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                onBlur={f.key === 'phone' ? (e) => setForm({ ...form, phone: formatPhone(e.target.value) }) : undefined}
                className="w-full rounded-md border border-slate-300 px-3 py-2 disabled:bg-slate-50 disabled:text-slate-500"
              />
            </label>
          ))}
        </div>
        <p className="mt-4 text-xs text-slate-400">
          This information appears on invoices and drives fiscal-year reporting. Sensitive fields (EIN) are stored encrypted at rest.
        </p>
      </Card>

      <div className="mt-6">
        <Branding editable={editable} onError={setErr} />
      </div>
    </Page>
  );
}

function Branding({ editable, onError }: { editable: boolean; onError: (m: string) => void }) {
  const { companyId } = useAuth();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [theme, setTheme] = useState<Theme>({});
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);

  const company = useQuery({ queryKey: ['company', companyId], enabled: !!companyId, queryFn: () => api.get('/company') });
  const logo = useQuery({ queryKey: ['company-logo', companyId], enabled: !!companyId, queryFn: () => api.get('/company/logo-url') });

  useEffect(() => { if (company.data?.theme) setTheme(company.data.theme); }, [company.data]);

  // Live preview as the user edits (reverts to saved theme on unmount/navigation).
  useEffect(() => { applyTheme(theme); }, [theme]);

  const value = (k: keyof Theme) => theme[k] ?? DEFAULT_THEME[k];
  const set = (k: keyof Theme, v: string) => setTheme((t) => ({ ...t, [k]: v }));

  const saveTheme = useMutation({
    mutationFn: () => api.patch('/company', { theme }),
    onSuccess: () => { setSaved(true); qc.invalidateQueries({ queryKey: ['company', companyId] }); setTimeout(() => setSaved(false), 2000); },
    onError: (e: any) => onError(e.message),
  });

  const onPickLogo = async (file: File) => {
    setUploading(true);
    try {
      const up = await api.post('/attachments/upload-url', {
        entityType: 'branding',
        entityId: companyId,
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
      });
      // PUT the bytes straight to object storage (presigned URL — no auth header).
      const put = await fetch(up.uploadUrl, { method: 'PUT', body: file, headers: { 'content-type': file.type || 'application/octet-stream' } });
      if (!put.ok) throw new Error(`Upload failed (${put.status}).`);
      await api.patch('/company', { logoStorageKey: up.storageKey });
      qc.invalidateQueries({ queryKey: ['company-logo', companyId] });
    } catch (e: any) {
      onError(e.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card title="Branding">
      {!editable && <p className="mb-3 text-sm text-amber-700">You have read-only access to branding.</p>}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <div className="mb-2 text-sm font-medium text-slate-600">Palette</div>
          <div className="space-y-2">
            {THEME_FIELDS.map((f) => (
              <label key={f.key} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-slate-600">{f.label}</span>
                <span className="flex items-center gap-2">
                  <input type="color" disabled={!editable} value={value(f.key)} onChange={(e) => set(f.key, e.target.value)} className="h-8 w-10 rounded border border-slate-300" />
                  <input disabled={!editable} value={value(f.key)} onChange={(e) => set(f.key, e.target.value)} className="w-24 rounded-md border border-slate-300 px-2 py-1 font-mono text-xs" />
                </span>
              </label>
            ))}
          </div>
          {editable && (
            <div className="mt-3 flex gap-2">
              <Button onClick={() => saveTheme.mutate()}>{saved ? 'Saved ✓' : 'Save palette'}</Button>
              <Button variant="ghost" onClick={() => setTheme(DEFAULT_THEME)}>Reset to default</Button>
            </div>
          )}
        </div>

        <div>
          <div className="mb-2 text-sm font-medium text-slate-600">Logo</div>
          <p className="mb-2 text-xs text-slate-400">Shown in the app sidebar and on invoices. PNG or SVG, ideally square.</p>
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50">
              {logo.data?.url ? <img src={logo.data.url} alt="Logo" className="h-full w-full rounded-lg object-contain" /> : <span className="text-xs text-slate-400">None</span>}
            </div>
            {editable && (
              <div>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickLogo(f); }} />
                <Button variant="ghost" onClick={() => fileRef.current?.click()}>{uploading ? 'Uploading…' : 'Upload logo'}</Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
