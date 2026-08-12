/**
 * Pure bank-statement parsers (CSV + minimal OFX/QFX) -> NormalizedTxn[].
 * No I/O. Deterministic externalId so re-importing the same file is idempotent.
 */
import { NormalizedTxn } from './provider.interface';

/** Deterministic id from the stable fields of a transaction line. */
function deriveExternalId(date: string, amount: string, description: string): string {
  const key = `${date}|${amount}|${description}`.toLowerCase();
  // Small FNV-1a hash -> hex; stable across imports.
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `csv_${(h >>> 0).toString(16)}`;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Normalize common date formats to YYYY-MM-DD. */
export function normalizeDate(raw: string): string {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/](\d{1,2})[/](\d{2,4})$/); // M/D/Y
  if (m) {
    const [, mm, dd, yy] = m;
    const year = yy.length === 2 ? `20${yy}` : yy;
    return `${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  throw new Error(`Unrecognized date: "${raw}"`);
}

export interface CsvMapping {
  date?: string;
  amount?: string;
  description?: string;
  debit?: string; // if the file has separate debit/credit columns
  credit?: string;
  id?: string;
}

const DEFAULTS: Required<Pick<CsvMapping, 'date' | 'amount' | 'description'>> = {
  date: 'date',
  amount: 'amount',
  description: 'description',
};

/**
 * Parse a CSV bank export. Supports a single signed `amount` column or separate
 * `debit`/`credit` columns. Column names are matched case-insensitively and can
 * be overridden via `mapping`.
 */
export function parseCsv(content: string, mapping: CsvMapping = {}): NormalizedTxn[] {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return [];

  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const idx = (name?: string) =>
    name ? header.indexOf(name.toLowerCase()) : -1;

  const dateIdx = idx(mapping.date ?? DEFAULTS.date);
  const descIdx = idx(mapping.description ?? DEFAULTS.description);
  const amountIdx = idx(mapping.amount ?? DEFAULTS.amount);
  const debitIdx = idx(mapping.debit);
  const creditIdx = idx(mapping.credit);
  const idIdx = idx(mapping.id);

  if (dateIdx < 0) throw new Error('CSV missing a date column.');
  if (amountIdx < 0 && debitIdx < 0 && creditIdx < 0) {
    throw new Error('CSV missing amount (or debit/credit) columns.');
  }

  const txns: NormalizedTxn[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const date = normalizeDate(cells[dateIdx]);
    const description = descIdx >= 0 ? cells[descIdx] ?? '' : '';

    let amount: string;
    if (amountIdx >= 0 && cells[amountIdx]) {
      amount = cells[amountIdx].replace(/[$,]/g, '');
    } else {
      const debit = debitIdx >= 0 ? cells[debitIdx]?.replace(/[$,]/g, '') : '';
      const credit = creditIdx >= 0 ? cells[creditIdx]?.replace(/[$,]/g, '') : '';
      if (credit && parseFloat(credit)) amount = credit;
      else if (debit && parseFloat(debit)) amount = `-${debit.replace('-', '')}`;
      else amount = '0';
    }

    const externalId =
      idIdx >= 0 && cells[idIdx]
        ? `csv_${cells[idIdx]}`
        : deriveExternalId(date, amount, description);

    txns.push({ externalId, postedDate: date, amount, description });
  }
  return txns;
}

/** Minimal OFX/QFX parser — extracts <STMTTRN> blocks. */
export function parseOfx(content: string): NormalizedTxn[] {
  const txns: NormalizedTxn[] = [];
  const blocks = content.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) ?? [];
  const tag = (block: string, name: string) => {
    const m = block.match(new RegExp(`<${name}>([^<\r\n]*)`, 'i'));
    return m ? m[1].trim() : '';
  };
  for (const b of blocks) {
    const dt = tag(b, 'DTPOSTED').slice(0, 8); // YYYYMMDD
    const postedDate = dt
      ? `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`
      : '';
    const amount = tag(b, 'TRNAMT');
    const description = tag(b, 'NAME') || tag(b, 'MEMO');
    const fitid = tag(b, 'FITID');
    txns.push({
      externalId: fitid ? `ofx_${fitid}` : deriveExternalId(postedDate, amount, description),
      postedDate,
      amount,
      description,
    });
  }
  return txns;
}
