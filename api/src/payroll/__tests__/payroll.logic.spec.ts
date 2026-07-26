import {
  PayrollError,
  computeRunTotals,
  normalizePayrollLine,
} from '../payroll.logic';

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
