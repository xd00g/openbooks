import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money, today } from '../lib/format';
import { Page, Card, Table, Button, Empty } from '../components/ui';

export default function Payroll() {
  const { companyId } = useAuth();
  const qc = useQueryClient();
  const key = (k: string) => [k, companyId];
  const [err, setErr] = useState('');

  const employees = useQuery({ queryKey: key('employees'), enabled: !!companyId, queryFn: () => api.get('/payroll/employees') });
  const runs = useQuery({ queryKey: key('runs'), enabled: !!companyId, queryFn: () => api.get('/payroll/runs') });

  const [emp, setEmp] = useState({ firstName: '', lastName: '' });
  const addEmp = useMutation({
    mutationFn: () => api.post('/payroll/employees', emp),
    onSuccess: () => { setEmp({ firstName: '', lastName: '' }); qc.invalidateQueries({ queryKey: key('employees') }); },
    onError: (e: any) => setErr(e.message),
  });

  // Run builder: amounts keyed by employeeId
  const [dates, setDates] = useState({ payDate: today(), periodStart: today(), periodEnd: today() });
  const [amts, setAmts] = useState<Record<string, { gross: string; employeeTaxes: string; employerTaxes: string; deductions: string }>>({});
  const setAmt = (id: string, field: string, v: string) =>
    setAmts((p) => {
      const cur = p[id] ?? { gross: '', employeeTaxes: '', employerTaxes: '', deductions: '' };
      return { ...p, [id]: { ...cur, [field]: v } };
    });

  const createRun = useMutation({
    mutationFn: () => {
      const lines = Object.entries(amts)
        .filter(([, a]) => Number(a.gross) > 0)
        .map(([employeeId, a]) => ({
          employeeId,
          gross: a.gross,
          employeeTaxes: a.employeeTaxes || '0',
          employerTaxes: a.employerTaxes || '0',
          deductions: a.deductions || '0',
        }));
      return api.post('/payroll/runs', { ...dates, lines });
    },
    onSuccess: () => { setAmts({}); qc.invalidateQueries({ queryKey: key('runs') }); },
    onError: (e: any) => setErr(e.message),
  });

  const finalize = (id: string) =>
    api.post(`/payroll/runs/${id}/finalize`).then(() => qc.invalidateQueries({ queryKey: key('runs') })).catch((e) => setErr(e.message));

  if (!companyId) return <Page title="Employees & Payroll"><Empty>Select a company.</Empty></Page>;

  return (
    <Page title="Employees & Payroll">
      {err && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="New employee">
          <div className="flex gap-2">
            <input value={emp.firstName} onChange={(e) => setEmp({ ...emp, firstName: e.target.value })} placeholder="First" className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm" />
            <input value={emp.lastName} onChange={(e) => setEmp({ ...emp, lastName: e.target.value })} placeholder="Last" className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm" />
            <Button onClick={() => addEmp.mutate()} disabled={!emp.firstName || !emp.lastName}>Add</Button>
          </div>
          <div className="mt-3 text-xs text-slate-500">{(employees.data ?? []).length} employees</div>
        </Card>
        <Card title="Pay period">
          <div className="grid grid-cols-3 gap-2 text-sm">
            <label className="text-xs text-slate-500">Pay date<input type="date" value={dates.payDate} onChange={(e) => setDates({ ...dates, payDate: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1" /></label>
            <label className="text-xs text-slate-500">Start<input type="date" value={dates.periodStart} onChange={(e) => setDates({ ...dates, periodStart: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1" /></label>
            <label className="text-xs text-slate-500">End<input type="date" value={dates.periodEnd} onChange={(e) => setDates({ ...dates, periodEnd: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1" /></label>
          </div>
        </Card>
      </div>

      <Card title="New payroll run (enter gross / taxes / deductions; net is computed)">
        <Table head={['Employee', 'Gross', 'EE taxes', 'ER taxes', 'Deductions']}>
          {(employees.data ?? []).map((e: any) => (
            <tr key={e.id}>
              <td className="px-4 py-2">{e.firstName} {e.lastName}</td>
              {(['gross', 'employeeTaxes', 'employerTaxes', 'deductions'] as const).map((f) => (
                <td key={f} className="px-4 py-1">
                  <input value={amts[e.id]?.[f] ?? ''} onChange={(ev) => setAmt(e.id, f, ev.target.value)} placeholder="0.00" className="w-24 rounded-md border border-slate-300 px-2 py-1 text-sm text-right" />
                </td>
              ))}
            </tr>
          ))}
          {(employees.data ?? []).length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-400">Add an employee first.</td></tr>}
        </Table>
        <div className="mt-3"><Button onClick={() => createRun.mutate()}>Create draft run</Button></div>
      </Card>

      <div className="mt-6">
        <Table head={['Pay date', 'Status', 'Gross', 'Net', '']}>
          {(runs.data ?? []).map((r: any) => (
            <tr key={r.id}>
              <td className="px-4 py-2">{new Date(r.payDate).toLocaleDateString('en-US')}</td>
              <td className="px-4 py-2 capitalize text-slate-500">{r.status}</td>
              <td className="px-4 py-2 text-right">{money(r.grossTotal)}</td>
              <td className="px-4 py-2 text-right">{money(r.netTotal)}</td>
              <td className="px-4 py-2 text-right">{r.status === 'draft' && <Button variant="ghost" onClick={() => finalize(r.id)}>Finalize</Button>}</td>
            </tr>
          ))}
          {(runs.data ?? []).length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-400">No runs yet.</td></tr>}
        </Table>
      </div>
    </Page>
  );
}
