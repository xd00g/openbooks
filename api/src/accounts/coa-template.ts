/**
 * Chart-of-Accounts templates (pure data + validation).
 *
 * A new company is seeded from one of these so AccountResolverService can find
 * the system accounts (AR, AP, Undeposited Funds, Sales Tax Payable, etc.) and
 * payroll posting has real accounts to hit. No Prisma/Nest here — testable in
 * isolation. Types mirror the Prisma AccountType/AccountSubtype enums.
 */

export type AccountTypeName =
  | 'asset'
  | 'liability'
  | 'equity'
  | 'income'
  | 'expense';

export type AccountSubtypeName =
  | 'bank'
  | 'accounts_receivable'
  | 'undeposited_funds'
  | 'inventory'
  | 'fixed_asset'
  | 'other_current_asset'
  | 'other_asset'
  | 'accounts_payable'
  | 'credit_card'
  | 'sales_tax_payable'
  | 'payroll_liability'
  | 'other_current_liability'
  | 'long_term_liability'
  | 'retained_earnings'
  | 'opening_balance_equity'
  | 'owners_equity'
  | 'income'
  | 'other_income'
  | 'cost_of_goods_sold'
  | 'expense'
  | 'other_expense';

export interface CoaAccount {
  code: string;
  name: string;
  type: AccountTypeName;
  subtype: AccountSubtypeName;
  /** System accounts are managed by the app and protected from deletion. */
  isSystem?: boolean;
  parentCode?: string;
}

export interface CoaTemplate {
  key: string;
  name: string;
  accounts: CoaAccount[];
}

/**
 * Well-known account codes the app relies on for automatic postings.
 * Keys match the shape PayrollPostingService expects in
 * company.settings.payrollAccounts.
 */
export const PAYROLL_ACCOUNT_CODES = {
  wageExpenseId: '6500',
  employerTaxExpenseId: '6510',
  cashAccountId: '1010',
  employeeTaxLiabilityId: '2310',
  deductionsLiabilityId: '2330',
  employerTaxLiabilityId: '2320',
} as const;

/**
 * Subtypes that MUST exist after seeding, because AccountResolverService
 * resolves them by subtype at posting time.
 */
export const REQUIRED_SUBTYPES: AccountSubtypeName[] = [
  'accounts_receivable',
  'accounts_payable',
  'undeposited_funds',
  'sales_tax_payable',
  'bank',
  'expense',
  'payroll_liability',
  'retained_earnings',
  'opening_balance_equity',
];

/** Standard general-purpose US small-business chart of accounts. */
export const STANDARD_US_SMB: CoaTemplate = {
  key: 'us-smb-general',
  name: 'US Small Business (General)',
  accounts: [
    // --- Assets (1000s) ---
    { code: '1010', name: 'Business Checking', type: 'asset', subtype: 'bank' },
    { code: '1020', name: 'Business Savings', type: 'asset', subtype: 'bank' },
    { code: '1050', name: 'Undeposited Funds', type: 'asset', subtype: 'undeposited_funds', isSystem: true },
    { code: '1100', name: 'Accounts Receivable', type: 'asset', subtype: 'accounts_receivable', isSystem: true },
    { code: '1200', name: 'Inventory Asset', type: 'asset', subtype: 'inventory' },
    { code: '1400', name: 'Prepaid Expenses', type: 'asset', subtype: 'other_current_asset' },
    { code: '1500', name: 'Fixed Assets', type: 'asset', subtype: 'fixed_asset' },
    { code: '1510', name: 'Accumulated Depreciation', type: 'asset', subtype: 'fixed_asset', parentCode: '1500' },

    // --- Liabilities (2000s) ---
    { code: '2000', name: 'Accounts Payable', type: 'liability', subtype: 'accounts_payable', isSystem: true },
    { code: '2100', name: 'Credit Card', type: 'liability', subtype: 'credit_card' },
    { code: '2200', name: 'Sales Tax Payable', type: 'liability', subtype: 'sales_tax_payable', isSystem: true },
    { code: '2300', name: 'Payroll Liabilities', type: 'liability', subtype: 'payroll_liability' },
    { code: '2310', name: 'Employee Tax Withholding', type: 'liability', subtype: 'payroll_liability', parentCode: '2300' },
    { code: '2320', name: 'Employer Payroll Taxes Payable', type: 'liability', subtype: 'payroll_liability', parentCode: '2300' },
    { code: '2330', name: 'Deductions Payable', type: 'liability', subtype: 'payroll_liability', parentCode: '2300' },
    { code: '2400', name: 'Other Current Liabilities', type: 'liability', subtype: 'other_current_liability' },
    { code: '2700', name: 'Long-Term Liabilities', type: 'liability', subtype: 'long_term_liability' },

    // --- Equity (3000s) ---
    { code: '3000', name: 'Opening Balance Equity', type: 'equity', subtype: 'opening_balance_equity', isSystem: true },
    { code: '3100', name: "Owner's Equity", type: 'equity', subtype: 'owners_equity' },
    { code: '3200', name: "Owner's Draw", type: 'equity', subtype: 'owners_equity', parentCode: '3100' },
    { code: '3900', name: 'Retained Earnings', type: 'equity', subtype: 'retained_earnings', isSystem: true },

    // --- Income (4000s) ---
    { code: '4000', name: 'Sales Income', type: 'income', subtype: 'income' },
    { code: '4100', name: 'Services Income', type: 'income', subtype: 'income' },
    { code: '4900', name: 'Other Income', type: 'income', subtype: 'other_income' },

    // --- Cost of Goods Sold (5000s) ---
    { code: '5000', name: 'Cost of Goods Sold', type: 'expense', subtype: 'cost_of_goods_sold' },

    // --- Operating Expenses (6000s) ---
    { code: '6000', name: 'Advertising & Marketing', type: 'expense', subtype: 'expense' },
    { code: '6100', name: 'Bank & Merchant Fees', type: 'expense', subtype: 'expense' },
    { code: '6200', name: 'Insurance', type: 'expense', subtype: 'expense' },
    { code: '6300', name: 'Office Supplies & Software', type: 'expense', subtype: 'expense' },
    { code: '6400', name: 'Rent & Lease', type: 'expense', subtype: 'expense' },
    { code: '6500', name: 'Payroll Wages', type: 'expense', subtype: 'expense' },
    { code: '6510', name: 'Employer Payroll Taxes', type: 'expense', subtype: 'expense', parentCode: '6500' },
    { code: '6600', name: 'Professional Services', type: 'expense', subtype: 'expense' },
    { code: '6700', name: 'Travel & Meals', type: 'expense', subtype: 'expense' },
    { code: '6800', name: 'Utilities', type: 'expense', subtype: 'expense' },
    { code: '6900', name: 'Other Expense', type: 'expense', subtype: 'other_expense' },
  ],
};

export const TEMPLATES: Record<string, CoaTemplate> = {
  [STANDARD_US_SMB.key]: STANDARD_US_SMB,
};

/**
 * Validate a template: unique codes, resolvable parents, and every required
 * subtype present. Throws on the first problem. Call this in tests/CI so a bad
 * template can never reach a real company.
 */
export function validateCoaTemplate(template: CoaTemplate): void {
  const codes = new Set<string>();
  for (const a of template.accounts) {
    if (codes.has(a.code)) {
      throw new Error(`Duplicate account code "${a.code}" in ${template.key}.`);
    }
    codes.add(a.code);
  }
  for (const a of template.accounts) {
    if (a.parentCode && !codes.has(a.parentCode)) {
      throw new Error(
        `Account "${a.code}" references missing parent "${a.parentCode}".`,
      );
    }
    if (a.parentCode === a.code) {
      throw new Error(`Account "${a.code}" cannot be its own parent.`);
    }
  }
  const subtypes = new Set(template.accounts.map((a) => a.subtype));
  for (const req of REQUIRED_SUBTYPES) {
    if (!subtypes.has(req)) {
      throw new Error(
        `Template ${template.key} is missing a required subtype: "${req}".`,
      );
    }
  }
  // Every code referenced by payroll wiring must exist.
  for (const code of Object.values(PAYROLL_ACCOUNT_CODES)) {
    if (!codes.has(code)) {
      throw new Error(
        `Template ${template.key} is missing payroll account code "${code}".`,
      );
    }
  }
}

/** Map the payroll account codes to their DB ids using a code->id lookup. */
export function buildPayrollAccountSettings(
  idByCode: Map<string, string>,
): Record<keyof typeof PAYROLL_ACCOUNT_CODES, string> {
  const out = {} as Record<keyof typeof PAYROLL_ACCOUNT_CODES, string>;
  for (const [key, code] of Object.entries(PAYROLL_ACCOUNT_CODES)) {
    const id = idByCode.get(code);
    if (!id) {
      throw new Error(`Payroll wiring: no seeded account for code "${code}".`);
    }
    out[key as keyof typeof PAYROLL_ACCOUNT_CODES] = id;
  }
  return out;
}
