/**
 * QuickBooks Desktop IIF (Intuit Interchange Format) parser — pure + dependency
 * free so it can be unit-tested in isolation.
 *
 * IIF is tab-delimited. A section begins with a header row whose first cell is
 * "!TYPE" (e.g. "!ACCNT") followed by column names; subsequent rows whose first
 * cell is "TYPE" carry values aligned to those columns:
 *
 *   !ACCNT<TAB>NAME<TAB>ACCNTTYPE<TAB>DESC<TAB>ACCNUM
 *   ACCNT<TAB>Checking<TAB>BANK<TAB>Main operating<TAB>1000
 *
 * We parse into generic sections, then project the ones we understand (ACCNT,
 * CUST, VEND) into normalized shapes the importer can commit.
 */

export interface IifSection {
  columns: string[];
  rows: Record<string, string>[];
}
export interface ParsedIif {
  sections: Record<string, IifSection>;
  warnings: string[];
}

export interface IifAccount {
  code: string | null; // QB ACCNUM (may be blank — importer assigns one)
  name: string;
  type: string;
  subtype: string;
  description?: string;
  qbType: string;
}
export interface IifParty {
  displayName: string;
  companyName?: string;
  email?: string;
  phone?: string;
  taxId?: string;
}

/** QuickBooks ACCNTTYPE -> our (type, subtype). */
const ACCNT_TYPE_MAP: Record<string, { type: string; subtype: string }> = {
  BANK: { type: 'asset', subtype: 'bank' },
  AR: { type: 'asset', subtype: 'accounts_receivable' },
  OCASSET: { type: 'asset', subtype: 'other_current_asset' },
  FIXASSET: { type: 'asset', subtype: 'fixed_asset' },
  OASSET: { type: 'asset', subtype: 'other_asset' },
  AP: { type: 'liability', subtype: 'accounts_payable' },
  CCARD: { type: 'liability', subtype: 'credit_card' },
  OCLIAB: { type: 'liability', subtype: 'other_current_liability' },
  LTLIAB: { type: 'liability', subtype: 'long_term_liability' },
  EQUITY: { type: 'equity', subtype: 'owners_equity' },
  INC: { type: 'income', subtype: 'income' },
  EXINC: { type: 'income', subtype: 'other_income' },
  EXP: { type: 'expense', subtype: 'expense' },
  EXEXP: { type: 'expense', subtype: 'other_expense' },
  COGS: { type: 'expense', subtype: 'cost_of_goods_sold' },
};

function unquote(v: string): string {
  const t = v.trim();
  return t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
}

/** Case-insensitive column lookup with fallbacks. */
function pick(row: Record<string, string>, ...names: string[]): string {
  for (const n of names) {
    const v = row[n] ?? row[n.toUpperCase()] ?? row[n.toLowerCase()];
    if (v != null && v !== '') return v;
  }
  return '';
}

export function parseIif(content: string): ParsedIif {
  const sections: Record<string, IifSection> = {};
  const warnings: string[] = [];
  const current: Record<string, string[]> = {}; // type -> active column list

  const lines = content.split(/\r\n|\r|\n/);
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const cells = raw.split('\t').map(unquote);
    const head = cells[0];
    if (!head) continue;

    if (head.startsWith('!')) {
      const type = head.slice(1).trim().toUpperCase();
      current[type] = cells.slice(1).map((c) => c.trim().toUpperCase());
      sections[type] ??= { columns: current[type], rows: [] };
      sections[type].columns = current[type];
    } else {
      const type = head.trim().toUpperCase();
      const cols = current[type];
      if (!cols) continue; // data row before its header — skip silently
      const row: Record<string, string> = {};
      cols.forEach((col, i) => {
        if (col) row[col] = cells[i + 1] ?? '';
      });
      (sections[type] ??= { columns: cols, rows: [] }).rows.push(row);
    }
  }

  return { sections, warnings };
}

export function toAccounts(parsed: ParsedIif): {
  accounts: IifAccount[];
  warnings: string[];
} {
  const section = parsed.sections['ACCNT'];
  const warnings: string[] = [];
  if (!section) return { accounts: [], warnings };

  const accounts: IifAccount[] = [];
  for (const row of section.rows) {
    const name = pick(row, 'NAME');
    if (!name) continue;
    const qbType = pick(row, 'ACCNTTYPE').toUpperCase();
    const mapped = ACCNT_TYPE_MAP[qbType];
    if (!mapped) {
      warnings.push(`Account "${name}": unknown QuickBooks type "${qbType || '(blank)'}" — imported as Other Asset.`);
    }
    const code = pick(row, 'ACCNUM');
    accounts.push({
      code: code || null,
      name,
      type: mapped?.type ?? 'asset',
      subtype: mapped?.subtype ?? 'other_asset',
      description: pick(row, 'DESC') || undefined,
      qbType: qbType || '(blank)',
    });
  }
  return { accounts, warnings };
}

function toParties(section: IifSection | undefined): IifParty[] {
  if (!section) return [];
  const out: IifParty[] = [];
  for (const row of section.rows) {
    const displayName = pick(row, 'NAME');
    if (!displayName) continue;
    out.push({
      displayName,
      companyName: pick(row, 'COMPANYNAME') || undefined,
      email: pick(row, 'EMAIL') || undefined,
      phone: pick(row, 'PHONE1', 'PHONE') || undefined,
      taxId: pick(row, 'TAXID') || undefined,
    });
  }
  return out;
}

export function toCustomers(parsed: ParsedIif): IifParty[] {
  return toParties(parsed.sections['CUST']);
}
export function toVendors(parsed: ParsedIif): IifParty[] {
  return toParties(parsed.sections['VEND']);
}

export interface IifEmployee {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
}

/** Split a QuickBooks full name into first/last. Handles both "First M Last"
 *  and the "Last, First" format QuickBooks often exports. */
function splitName(full: string): { firstName: string; lastName: string } {
  const s = full.trim();
  if (s.includes(',')) {
    const [last, first] = s.split(',', 2).map((x) => x.trim());
    return { firstName: first || last, lastName: first ? last : '' };
  }
  const parts = s.split(/\s+/);
  if (parts.length <= 1) return { firstName: s, lastName: '' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

export function toEmployees(parsed: ParsedIif): IifEmployee[] {
  const section = parsed.sections['EMP'];
  if (!section) return [];
  const out: IifEmployee[] = [];
  for (const row of section.rows) {
    const name = pick(row, 'NAME');
    if (!name) continue;
    out.push({
      ...splitName(name),
      email: pick(row, 'EMAIL') || undefined,
      phone: pick(row, 'PHONE1', 'PHONE') || undefined,
    });
  }
  return out;
}

export interface IifItem {
  name: string;
  description?: string;
  unitPrice?: string;
  type: string;
}

const ITEM_TYPE_MAP: Record<string, string> = {
  SERV: 'service',
  INVENTORY: 'product',
  PART: 'product',
  NONINVENTORY: 'product',
  GROUP: 'bundle',
  ASSEMBLY: 'bundle',
};

export function toItems(parsed: ParsedIif): IifItem[] {
  // QuickBooks item lists export under INVITEM (occasionally ITEM).
  const section = parsed.sections['INVITEM'] ?? parsed.sections['ITEM'];
  if (!section) return [];
  const out: IifItem[] = [];
  for (const row of section.rows) {
    const name = pick(row, 'NAME');
    if (!name) continue;
    out.push({
      name,
      description: pick(row, 'DESC') || undefined,
      unitPrice: pick(row, 'PRICE', 'SALESPRICE') || undefined,
      type: ITEM_TYPE_MAP[pick(row, 'INVITEMTYPE').toUpperCase()] ?? 'service',
    });
  }
  return out;
}

/** Row counts for EVERY section found in the file (incl. ones we don't import),
 *  so the preview can show the user exactly what QuickBooks exported. */
export function sectionCounts(parsed: ParsedIif): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [type, sec] of Object.entries(parsed.sections)) {
    out[type] = sec.rows.length;
  }
  return out;
}
