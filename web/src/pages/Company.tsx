import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Page, Card, Button, Empty } from '../components/ui';

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
      {err && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
      {!editable && <div className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">You have read-only access to company settings.</div>}
      <Card title="Company profile">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <label key={f.key} className="text-sm">
              <span className="mb-1 block font-medium text-slate-600">{f.label}</span>
              <input
                type={f.type ?? 'text'}
                value={form[f.key] ?? ''}
                disabled={!editable}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-3 py-2 disabled:bg-slate-50 disabled:text-slate-500"
              />
            </label>
          ))}
        </div>
        <p className="mt-4 text-xs text-slate-400">
          This information appears on invoices and drives fiscal-year reporting. Sensitive fields (EIN) are stored encrypted at rest.
        </p>
      </Card>
    </Page>
  );
}
