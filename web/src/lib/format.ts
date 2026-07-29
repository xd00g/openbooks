export const money = (v: string | number | null | undefined, currency = 'USD') =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(Number(parseAmount(v) ?? 0));

/** Strip currency symbols/commas/whitespace from a user-typed amount so
 *  Number()/parseFloat() don't choke on "$1,000,000.00" -> NaN. Returns the
 *  cleaned numeric string (still a string, for controlled inputs). */
export const cleanAmount = (v: string | number | null | undefined): string => {
  if (v == null) return '';
  const s = String(v).replace(/[^0-9.\-]/g, '');
  return s;
};

/** Like cleanAmount, but returns a number (0 if unparseable) — for arithmetic. */
export const parseAmount = (v: string | number | null | undefined): number => {
  const n = Number(cleanAmount(v));
  return Number.isFinite(n) ? n : 0;
};

export const date = (v: string | Date | null | undefined) =>
  v ? new Date(v).toLocaleDateString('en-US') : '';

export const today = () => new Date().toISOString().slice(0, 10);
export const startOfYear = () => `${new Date().getUTCFullYear()}-01-01`;
