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

/** Format a US-style phone number as (XXX) XXX-XXXX. A leading country code
 *  is preserved as a "+N " prefix (e.g. "+44 XXX..."); anything that doesn't
 *  parse as 10/11 digits (extensions, international numbers) is left as-is
 *  rather than mangled. Used for both display and on-blur input formatting. */
export const formatPhone = (v: string | null | undefined): string => {
  if (!v) return '';
  const digits = v.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length > 11) {
    // Unusual length (extension, intl number) — prefix the country code(s)
    // and format the trailing 10 digits, rather than guessing further.
    const cc = digits.slice(0, digits.length - 10);
    const rest = digits.slice(-10);
    return `+${cc} (${rest.slice(0, 3)}) ${rest.slice(3, 6)}-${rest.slice(6)}`;
  }
  return v; // too short to be a real number — leave whatever was typed
};

export const date = (v: string | Date | null | undefined) =>
  v ? new Date(v).toLocaleDateString('en-US') : '';

export const today = () => new Date().toISOString().slice(0, 10);
export const startOfYear = () => `${new Date().getUTCFullYear()}-01-01`;
