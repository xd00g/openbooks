import {
  parseIif,
  toAccounts,
  toCustomers,
  toVendors,
} from '../iif.logic';

const SAMPLE = [
  '!ACCNT\tNAME\tACCNTTYPE\tDESC\tACCNUM',
  'ACCNT\tChecking\tBANK\tMain operating\t1000',
  'ACCNT\tSales Income\tINC\t\t',
  'ACCNT\tMystery\tWEIRD\t\t',
  '!CUST\tNAME\tCOMPANYNAME\tEMAIL\tPHONE1',
  'CUST\tAcme Inc\tAcme Incorporated\tbill@acme.com\t555-1000',
  '!VEND\tNAME\tCOMPANYNAME\tTAXID',
  'VEND\t"Supplier, LLC"\tSupplier\t12-3456789',
].join('\r\n');

describe('IIF parser', () => {
  const parsed = parseIif(SAMPLE);

  it('splits sections by header rows', () => {
    expect(Object.keys(parsed.sections).sort()).toEqual(['ACCNT', 'CUST', 'VEND']);
    expect(parsed.sections['ACCNT'].rows).toHaveLength(3);
  });

  it('maps QuickBooks account types', () => {
    const { accounts, warnings } = toAccounts(parsed);
    const checking = accounts.find((a) => a.name === 'Checking')!;
    expect(checking).toMatchObject({ code: '1000', type: 'asset', subtype: 'bank' });

    const sales = accounts.find((a) => a.name === 'Sales Income')!;
    expect(sales).toMatchObject({ code: null, type: 'income', subtype: 'income' });

    // Unknown type falls back and warns.
    const mystery = accounts.find((a) => a.name === 'Mystery')!;
    expect(mystery.subtype).toBe('other_asset');
    expect(warnings.some((w) => w.includes('Mystery'))).toBe(true);
  });

  it('extracts customers and vendors, unquoting values', () => {
    const customers = toCustomers(parsed);
    expect(customers).toHaveLength(1);
    expect(customers[0]).toMatchObject({ displayName: 'Acme Inc', email: 'bill@acme.com' });

    const vendors = toVendors(parsed);
    expect(vendors[0].displayName).toBe('Supplier, LLC'); // quoted value with a comma
    expect(vendors[0].taxId).toBe('12-3456789');
  });

  it('ignores blank lines and data rows with no header', () => {
    const p = parseIif('\n\nACCNT\tOrphan\tBANK\n');
    expect(p.sections['ACCNT']).toBeUndefined();
  });
});
