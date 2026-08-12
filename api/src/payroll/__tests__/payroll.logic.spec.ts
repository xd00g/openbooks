import {
  PayrollError,
  computeGross,
  computeRunTotals,
  normalizePayrollLine,
} from '../payroll.logic';

describe('computeGross', () => {
  it('hourly = rate x hours (exact)', () => {
    expect(computeGross({ payType: 'hourly', payRate: '27.50', hours: '80' })).toBe('2200.0000');
  });
  it('hourly with fractional hours', () => {
    expect(computeGross({ payType: 'hourly', payRate: '20', hours: '10.25' })).toBe('205.0000');
  });
  it('salary = annual / periods (default 26 biweekly)', () => {
    expect(computeGross({ payType: 'salary', payRate: '78000' })).toBe('3000.0000');
  });
  it('salary honors periodsPerYear (24 semimonthly)', () => {
    expect(computeGross({ payType: 'salary', payRate: '96000', periodsPerYear: 24 })).toBe('4000.0000');
  });
  it('defaults to hourly with zero hours -> 0', () => {
    expect(computeGross({ payRate: '50' })).toBe('0.0000');
  });
});

describe('normalizePayrollLine', () => {
  it('computes net when omitted', () => {
    const l = normalizePayrollLine({
      employeeId: 'e1',
      gross: '5000.00',
      employeeTaxes: '1200.00',
      deductions: '300.00',
      employerTaxes: '400.00',
    });
    expect(l.net).toBe('3500.0000');
  });

  it('accepts a matching provided net', () => {
    const l = normalizePayrollLine({
      employeeId: 'e1',
      gross: '3000.00',
      employeeTaxes: '650.00',
      deductions: '150.00',
      net: '2200.00',
    });
    expect(l.net).toBe('2200.0000');
    expect(l.employerTaxes).toBe('0.0000');
  });

  it('rejects a net that violates the identity', () => {
    expect(() =>
      normalizePayrollLine({
        employeeId: 'e1',
        gross: '5000.00',
        employeeTaxes: '1200.00',
        deductions: '300.00',
        net: '9999.00',
      }),
    ).toThrow(PayrollError);
  });

  it('rejects negative amounts', () => {
    expect(() =>
      normalizePayrollLine({ employeeId: 'e1', gross: '-1', }),
    ).toThrow(PayrollError);
  });
});

describe('computeRunTotals', () => {
  it('sums across employees', () => {
    const lines = [
      normalizePayrollLine({ employeeId: 'e1', gross: '5000.00', employeeTaxes: '1200.00', employerTaxes: '400.00', deductions: '300.00' }),
      normalizePayrollLine({ employeeId: 'e2', gross: '3000.00', employeeTaxes: '650.00', employerTaxes: '240.00', deductions: '150.00' }),
    ];
    const t = computeRunTotals(lines);
    expect(t.grossTotal).toBe('8000.0000');
    expect(t.netTotal).toBe('5700.0000');
    expect(t.employerTaxTotal).toBe('640.0000');
  });
});
