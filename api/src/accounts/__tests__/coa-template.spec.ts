import {
  PAYROLL_ACCOUNT_CODES,
  REQUIRED_SUBTYPES,
  STANDARD_US_SMB,
  TEMPLATES,
  buildPayrollAccountSettings,
  validateCoaTemplate,
} from '../coa-template';

describe('coa-template', () => {
  it('the standard template is internally valid', () => {
    expect(() => validateCoaTemplate(STANDARD_US_SMB)).not.toThrow();
  });

  it('all registered templates are valid', () => {
    for (const t of Object.values(TEMPLATES)) {
      expect(() => validateCoaTemplate(t)).not.toThrow();
    }
  });

  it('contains every subtype the resolver needs', () => {
    const subtypes = new Set(STANDARD_US_SMB.accounts.map((a) => a.subtype));
    for (const req of REQUIRED_SUBTYPES) {
      expect(subtypes.has(req)).toBe(true);
    }
  });

  it('has unique account codes', () => {
    const codes = STANDARD_US_SMB.accounts.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('every parentCode resolves to a real account', () => {
    const codes = new Set(STANDARD_US_SMB.accounts.map((a) => a.code));
    for (const a of STANDARD_US_SMB.accounts) {
      if (a.parentCode) expect(codes.has(a.parentCode)).toBe(true);
    }
  });

  it('maps payroll codes to ids and fails on a missing one', () => {
    const idByCode = new Map(
      STANDARD_US_SMB.accounts.map((a) => [a.code, `id-${a.code}`]),
    );
    const cfg = buildPayrollAccountSettings(idByCode);
    expect(cfg.wageExpenseId).toBe(`id-${PAYROLL_ACCOUNT_CODES.wageExpenseId}`);
    expect(cfg.employerTaxLiabilityId).toBe(
      `id-${PAYROLL_ACCOUNT_CODES.employerTaxLiabilityId}`,
    );

    const incomplete = new Map([['1010', 'id-1010']]);
    expect(() => buildPayrollAccountSettings(incomplete)).toThrow();
  });

  it('rejects a template with a duplicate code', () => {
    const bad = {
      key: 'bad',
      name: 'bad',
      accounts: [
        { code: '1000', name: 'A', type: 'asset', subtype: 'bank' as const },
        { code: '1000', name: 'B', type: 'asset', subtype: 'bank' as const },
      ],
    };
    expect(() => validateCoaTemplate(bad as never)).toThrow(/Duplicate/);
  });
});
