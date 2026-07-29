import { ReactNode, useMemo, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Page, Table, Button, Empty, Modal, SearchInput, Banner, toggleSort, type SortState } from './ui';
import { formatPhone } from '../lib/format';

export interface FieldDef {
  key: string;
  label: string;
  type?: 'text' | 'select' | 'checkbox' | 'date' | 'phone';
  options?: { value: string; label: string }[];
  writeOnly?: boolean; // never populated from the row (e.g. encrypted SSN); only sent if filled
  fromRow?: (row: any) => string; // custom value when editing (e.g. derive % from a decimal)
  full?: boolean; // span both columns
  optionsEndpoint?: string; // type:'select' — fetch options from this endpoint
  optionFilter?: (row: any) => boolean;
  optionValue?: string; // default 'id'
  optionLabel?: (row: any) => string;
}

export interface EntityConfig {
  title: string;
  endpoint: string; // e.g. '/sales/customers'
  queryKey: string; // e.g. 'customers'
  columns: { key: string; label: string; render?: (row: any) => ReactNode; sortValue?: (row: any) => string | number; noSort?: boolean }[];
  fields: FieldDef[];
  addressKey?: string; // e.g. 'billingAddress' | 'address' — a JSON sub-object
  addressLabel?: string;
  newLabel: string;
}

const ADDR: [string, string][] = [
  ['line1', 'Address'], ['line2', 'Address 2'], ['city', 'City'],
  ['region', 'State/Region'], ['postalCode', 'Postal code'], ['country', 'Country'],
];

export default function EntityManager({ config }: { config: EntityConfig }) {
  const { companyId } = useAuth();
  const qc = useQueryClient();
  const key = [config.queryKey, companyId];
  const [err, setErr] = useState('');
  const [form, setForm] = useState<any | null>(null); // null = closed; {} = new; {...} = edit
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortState | null>(null);

  const list = useQuery({ queryKey: key, enabled: !!companyId, queryFn: () => api.get(config.endpoint) });

  // Fetch options for any select fields that pull from an endpoint.
  const optFields = config.fields.filter((f) => f.optionsEndpoint);
  const optResults = useQueries({
    queries: optFields.map((f) => ({ queryKey: [f.optionsEndpoint, companyId], enabled: !!companyId, queryFn: () => api.get(f.optionsEndpoint!) })),
  });
  const optionsByKey: Record<string, any[]> = {};
  optFields.forEach((f, i) => {
    let data = ((optResults[i].data as any[]) ?? []);
    if (f.optionFilter) data = data.filter(f.optionFilter);
    optionsByKey[f.key] = data;
  });

  const openNew = () => {
    const f: any = {};
    for (const fd of config.fields) f[fd.key] = fd.type === 'checkbox' ? false : '';
    if (config.addressKey) for (const [k] of ADDR) f[`addr_${k}`] = '';
    setForm(f);
  };
  const openEdit = (row: any) => {
    const f: any = { id: row.id };
    for (const fd of config.fields) f[fd.key] = fd.writeOnly ? '' : fd.fromRow ? fd.fromRow(row) : (row[fd.key] ?? (fd.type === 'checkbox' ? false : ''));
    if (config.addressKey) { const a = row[config.addressKey] ?? {}; for (const [k] of ADDR) f[`addr_${k}`] = a[k] ?? ''; }
    setForm(f);
  };

  const save = useMutation({
    mutationFn: () => {
      const body: any = {};
      for (const fd of config.fields) {
        const v = form[fd.key];
        if (fd.type === 'checkbox') body[fd.key] = !!v;
        else if (v !== '' && v != null) body[fd.key] = v;
      }
      if (config.addressKey) {
        const a: any = {};
        for (const [k] of ADDR) if (form[`addr_${k}`]) a[k] = form[`addr_${k}`];
        if (Object.keys(a).length) body[config.addressKey] = a;
      }
      return form.id ? api.patch(`${config.endpoint}/${form.id}`, body) : api.post(config.endpoint, body);
    },
    onSuccess: () => { setForm(null); qc.invalidateQueries({ queryKey: key }); },
    onError: (e: any) => setErr(e.message),
  });

  const toggleActive = (row: any) =>
    api.patch(`${config.endpoint}/${row.id}`, { isActive: !(row.isActive ?? true) })
      .then(() => qc.invalidateQueries({ queryKey: key })).catch((e) => setErr(e.message));

  if (!companyId) return <Page title={config.title}><Empty>Select a company.</Empty></Page>;

  const allRows = list.data ?? [];
  const colValue = (c: EntityConfig['columns'][number], row: any) => (c.sortValue ? c.sortValue(row) : c.render ? c.render(row) : row[c.key]);
  const rows = useMemo(() => {
    let r = allRows;
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      r = r.filter((row: any) => config.columns.some((c) => String(colValue(c, row) ?? '').toLowerCase().includes(needle)));
    }
    if (sort) {
      const col = config.columns.find((c) => c.key === sort.key);
      r = [...r].sort((a: any, b: any) => {
        const va = col ? colValue(col, a) : a[sort.key];
        const vb = col ? colValue(col, b) : b[sort.key];
        const cmp = va == null ? -1 : vb == null ? 1 : va > vb ? 1 : va < vb ? -1 : 0;
        return sort.dir === 'asc' ? cmp : -cmp;
      });
    }
    return r;
  }, [allRows, q, sort]);

  return (
    <Page title={config.title} actions={<Button onClick={openNew}>{config.newLabel}</Button>}>
      <Banner text={err} />
      <div className="mb-3"><SearchInput value={q} onChange={setQ} placeholder={`Search ${config.title.toLowerCase()}…`} /></div>
      <Table
        head={[...config.columns.map((c) => (c.noSort ? c.label : { label: c.label, key: c.key })), 'Active', '']}
        sort={sort}
        onSort={(k) => setSort((s) => toggleSort(s, k))}
      >
        {rows.map((row: any) => (
          <tr key={row.id} className={row.isActive === false ? 'opacity-50' : ''}>
            {config.columns.map((c) => (
              <td key={c.key} className="px-4 py-2">{c.render ? c.render(row) : (row[c.key] ?? '—')}</td>
            ))}
            <td className="px-4 py-2">
              <button onClick={() => toggleActive(row)} className="text-xs text-slate-500 hover:underline">
                {row.isActive === false ? 'Inactive' : 'Active'}
              </button>
            </td>
            <td className="px-4 py-2 text-right"><Button variant="ghost" onClick={() => openEdit(row)}>Edit</Button></td>
          </tr>
        ))}
        {rows.length === 0 && <tr><td colSpan={config.columns.length + 2} className="px-4 py-6 text-center text-sm text-slate-400">{q.trim() ? 'No matches.' : 'None yet.'}</td></tr>}
      </Table>

      {form && (
        <Modal title={form.id ? `Edit ${config.title.replace(/s$/, '')}` : config.newLabel} onClose={() => setForm(null)}>
          <div className="grid grid-cols-2 gap-2">
            {config.fields.map((fd) => (
              <label key={fd.key} className={`text-xs text-slate-500 ${fd.full ? 'col-span-2' : ''}`}>
                {fd.label}
                {fd.type === 'select' ? (
                  <select value={form[fd.key]} onChange={(e) => setForm({ ...form, [fd.key]: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm">
                    {fd.optionsEndpoint ? (
                      <>
                        <option value="">—</option>
                        {(optionsByKey[fd.key] ?? []).map((o: any) => (
                          <option key={o[fd.optionValue ?? 'id']} value={o[fd.optionValue ?? 'id']}>{fd.optionLabel ? fd.optionLabel(o) : o.name}</option>
                        ))}
                      </>
                    ) : (
                      (fd.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)
                    )}
                  </select>
                ) : fd.type === 'checkbox' ? (
                  <div className="mt-1"><input type="checkbox" checked={!!form[fd.key]} onChange={(e) => setForm({ ...form, [fd.key]: e.target.checked })} /></div>
                ) : (
                  <input type={fd.type === 'date' ? 'date' : fd.type === 'phone' ? 'tel' : 'text'} value={form[fd.key]} onChange={(e) => setForm({ ...form, [fd.key]: e.target.value })}
                    onBlur={fd.type === 'phone' ? (e) => setForm({ ...form, [fd.key]: formatPhone(e.target.value) }) : undefined}
                    placeholder={fd.writeOnly && form.id ? '•••• (leave blank to keep)' : ''}
                    className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm" />
                )}
              </label>
            ))}
            {config.addressKey && (
              <>
                <div className="col-span-2 mt-1 text-xs font-medium uppercase tracking-wide text-slate-400">{config.addressLabel ?? 'Address'}</div>
                {ADDR.map(([k, label]) => (
                  <label key={k} className="text-xs text-slate-500">{label}
                    <input value={form[`addr_${k}`]} onChange={(e) => setForm({ ...form, [`addr_${k}`]: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm" />
                  </label>
                ))}
              </>
            )}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={!form[config.fields[0].key]}>Save</Button>
          </div>
        </Modal>
      )}
    </Page>
  );
}
