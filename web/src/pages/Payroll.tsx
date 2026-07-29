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

  const emptyEmp = { firstName: '', lastName: '', email: '', phone: '', payType: 'hourly', payRate: '', ssn: '', hireDate: '', filingStatus: '', line1: '', city: '', region: '', postalCode: '', country: '' };
  const [emp, setEmp] = useState(emptyEmp);
  const addEmp = useMutation({
    mutationFn: () => {
      const { line1, city, region, postalCode, country, ...rest } = emp;
      const address = (line1 || city || region || postalCode || country) ? { line1, city, region, postalCode, country } : undefined;
      const payload: any = { payType: emp.payType };
      if (address) payload.address = address;
      for (const [k, v] of Object.entries(rest)) if (v) payload[k] = v;
      return api.post('/payroll/employees', payload);
    },
    onSuccess: () => { setEmp(emptyEmp); qc.invalidateQueries({ queryKey: key('employees') }); },
    onError: (e: any) => setErr(e.message),
  });

  // Run builder: amounts keyed by employeeId
  const [dates, setDates] = useState({ payDate: today(), periodStart: today(), periodEnd: today() });
  const [amts, setAmts] = useState<Record<string, { hours: string; gross: string; employeeTaxes: string; employerTaxes: string; deductions: string }>>({});
  const setAmt = (id: string, field: string, v: string) =>
    setAmts((p) => {
      const cur = p[id] ?? { hours: '', gross: '', employeeTaxes: '', employerTaxes: '', deductions: '' };
      return { ...p, [id]: { ...cur, [field]: v } };
    });

  const createRun = useMutation({
    mutationFn: () => {
      const lines = Object.entries(amts)
        .filter(([, a]) => Number(a.gross) > 0 || Number(a.hours) > 0)
        .map(([employeeId, a]) => ({
          employeeId,
          ...(a.gross ? { gross: a.gross } : {}), // omit gross -> server computes from hours/salary
          ...(a.hours ? { hours: a.hours } : {}),
          employeeTaxes: a.employeeTaxes || '0',
          employerTaxes: a.employerTaxes || '0',
          deductions: a.deductions || '0',
        }));
      return api.post('/payroll/runs', { ...dates, lines });
    },
    onSuccess: () => { setAmts({}); qc.invalidateQueries({ queryKey: key('runs') }); },
    onError: (e: any) => setErr(e.message),
  });

  const runAction = (p: Promise<any>) =>
    p.then(() => qc.invalidateQueries({ queryKey: key('runs') })).catch((e) => setErr(e.message));
  const finalize = (id: string) => runAction(api.post(`/payroll/runs/${id}/finalize`));
  const voidRun = (id: string) => { if (confirm('Void this payroll run? A reversing entry will be posted.')) runAction(api.post(`/payroll/runs/${id}/void`)); };
  const deleteRun = (id: string) => { if (confirm('Delete this draft run?')) runAction(api.del(`/payroll/runs/${id}`)); };

  if (!companyId) return <Page title="Employees & Payroll"><Empty>Select a company.</Empty></Page>;

  return (
    <Page title="Employees & Payroll">
      {err && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="New employee">
          <div className="grid grid-cols-2 gap-2">
            {([
              ['firstName', 'First name *'], ['lastName', 'Last name *'],
              ['email', 'Email'], ['phone', 'Phone'],
              ['ssn', 'SSN (encrypted)'], ['payRate', 'Pay rate'],
              ['line1', 'Address'], ['city', 'City'], ['region', 'State'],
              ['postalCode', 'Postal code'], ['country', 'Country'], ['filingStatus', 'Filing status'],
            ] as [Exclude<keyof typeof emp, 'payType' | 'hireDate'>, string][]).map(([f, label]) => (
              <input key={f} value={emp[f]} onChange={(e) => setEmp({ ...emp, [f]: e.target.value })}
                placeholder={label} className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
            ))}
            <select value={emp.payType} onChange={(e) => setEmp({ ...emp, payType: e.target.value })} className="rounded-md border border-slate-300 px-2 py-1 text-sm">
              <option value="hourly">Hourly</option>
              <option value="salary">Salary (annual)</option>
            </select>
            <label className="text-xs text-slate-500">Hire date<input type="date" value={emp.hireDate} onChange={(e) => setEmp({ ...emp, hireDate: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm" /></label>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-slate-500">{(employees.data ?? []).length} employees</span>
            <Button onClick={() => addEmp.mutate()} disabled={!emp.firstName || !emp.lastName}>Add employee</Button>
          </div>
        </Card>
        <Card title="Pay period">
          <div className="grid grid-cols-3 gap-2 text-sm">
            <label className="text-xs text-slate-500">Pay date<input type="date" value={dates.payDate} onChange={(e) => setDates({ ...dates, payDate: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1" /></label>
            <label className="text-xs text-slate-500">Start<input type="date" value={dates.periodStart} onChange={(e) => setDates({ ...dates, periodStart: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1" /></label>
            <label className="text-xs text-slate-500">End<input type="date" value={dates.periodEnd} onChange={(e) => setDates({ ...dates, periodEnd: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1" /></label>
          </div>
        </Card>
      </div>

      <Card title="New payroll run (hourly: enter hours → gross auto-computes; or type gross directly. Net is computed.)">
        <Table head={['Employee', 'Type', 'Hours', 'Gross', 'EE taxes', 'ER taxes', 'Deductions']}>
          {(employees.data ?? []).map((e: any) => (
            <tr key={e.id}>
              <td className="px-4 py-2">{e.firstName} {e.lastName}</td>
              <td className="px-4 py-2 text-xs capitalize text-slate-500">{e.payType ?? 'hourly'}{e.payRate ? ` @ ${money(e.payRate)}` : ''}</td>
              {(['hours', 'gross', 'employeeTaxes', 'employerTaxes', 'deductions'] as const).map((f) => (
                <td key={f} className="px-4 py-1">
                  <input value={amts[e.id]?.[f] ?? ''} onChange={(ev) => setAmt(e.id, f, ev.target.value)}
                    placeholder={f === 'hours' ? (e.payType === 'salary' ? '—' : 'hrs') : '0.00'}
                    disabled={f === 'hours' && e.payType === 'salary'}
                    className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm text-right disabled:bg-slate-100" />
                </td>
              ))}
            </tr>
          ))}
          {(employees.data ?? []).length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-400">Add an employee first.</td></tr>}
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
              <td className="px-4 py-2 text-right">
                <span className="inline-flex gap-2">
                  {r.status === 'draft' && <Button variant="ghost" onClick={() => finalize(r.id)}>Finalize</Button>}
                  {r.status === 'draft' && <Button variant="ghost" onClick={() => deleteRun(r.id)}>Delete</Button>}
                  {r.status === 'posted' && <Button variant="ghost" onClick={() => voidRun(r.id)}>Void</Button>}
                </span>
              </td>
            </tr>
          ))}
          {(runs.data ?? []).length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-400">No runs yet.</td></tr>}
        </Table>
      </div>
    </Page>
  );
}
