import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Modal, Button } from './ui';

/**
 * Create a new company. Works both for a brand-new user with no memberships
 * (bootstraps their org) and for adding another company to an existing org.
 * On success the new company becomes the active company.
 */
export default function CreateCompanyDialog({
  onClose,
  firstRun = false,
}: {
  onClose: () => void;
  firstRun?: boolean;
}) {
  const { me, setCompany, refresh } = useAuth();
  const hasOrg = (me?.memberships ?? []).length > 0;
  const [form, setForm] = useState({
    legalName: '',
    organizationName: '',
    baseCurrency: 'USD',
    country: 'US',
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!form.legalName.trim()) {
      setErr('Company legal name is required.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const payload: Record<string, string> = {
        legalName: form.legalName.trim(),
        baseCurrency: form.baseCurrency.trim() || 'USD',
        country: form.country.trim() || 'US',
      };
      if (!hasOrg && form.organizationName.trim()) {
        payload.organizationName = form.organizationName.trim();
      }
      const res = await api.post<{ companyId: string }>('/onboarding/company', payload);
      setCompany(res.companyId);
      await refresh();
      onClose();
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  };

  const field = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm';

  return (
    <Modal title={firstRun ? 'Create your first company' : 'New company'} onClose={onClose}>
      {firstRun && (
        <p className="mb-4 text-sm text-slate-500">
          Welcome to OpenBooks! Set up a company to start keeping its books. You
          can add more companies later.
        </p>
      )}
      {err && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-600">Company legal name</span>
          <input
            autoFocus
            value={form.legalName}
            onChange={(e) => setForm({ ...form, legalName: e.target.value })}
            placeholder="Acme LLC"
            className={field}
          />
        </label>
        {!hasOrg && (
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-600">
              Organization name <span className="font-normal text-slate-400">(optional)</span>
            </span>
            <input
              value={form.organizationName}
              onChange={(e) => setForm({ ...form, organizationName: e.target.value })}
              placeholder="Defaults to the company name"
              className={field}
            />
          </label>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-600">Base currency</span>
            <input
              value={form.baseCurrency}
              onChange={(e) => setForm({ ...form, baseCurrency: e.target.value.toUpperCase().slice(0, 3) })}
              className={field}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-600">Country</span>
            <input
              value={form.country}
              onChange={(e) => setForm({ ...form, country: e.target.value.toUpperCase().slice(0, 2) })}
              className={field}
            />
          </label>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        {!firstRun && <Button variant="ghost" onClick={onClose}>Cancel</Button>}
        <Button onClick={submit} disabled={busy || !form.legalName.trim()}>
          {busy ? 'Creating…' : 'Create company'}
        </Button>
      </div>
    </Modal>
  );
}
