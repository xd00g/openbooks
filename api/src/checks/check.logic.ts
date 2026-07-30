/**
 * Pure check-printing rules — no DB, no NestJS (CLAUDE.md logic/IO split).
 *
 * Covers the three things that must never be wrong on a printed check:
 * the legal (written) amount, the number sequence, and void preconditions.
 */

export class CheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckError';
  }
}

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
  'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
  'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const TENS = [
  '', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy',
  'eighty', 'ninety',
];
/** Index = group position from the right. 5 groups x 3 digits = the 15
 *  integer digits Decimal(19,4) permits. */
const SCALES = ['', 'thousand', 'million', 'billion', 'trillion'];

/** Words for 1..999. Callers skip zero groups, so 0 never reaches here. */
function groupToWords(n: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds > 0) parts.push(`${ONES[hundreds]} hundred`);
  if (rest > 0) {
    if (rest < 20) {
      parts.push(ONES[rest]);
    } else {
      const t = Math.floor(rest / 10);
      const o = rest % 10;
      parts.push(o > 0 ? `${TENS[t]}-${ONES[o]}` : TENS[t]);
    }
  }
  return parts.join(' ');
}

function wholeToWords(digits: string): string {
  const trimmed = digits.replace(/^0+/, '');
  if (trimmed === '') return 'zero';

  // Split into 3-digit groups from the right: "1000005" -> [5, 0, 1]
  const groups: number[] = [];
  let rest = trimmed;
  while (rest.length > 0) {
    groups.push(Number(rest.slice(-3)));
    rest = rest.slice(0, -3);
  }
  if (groups.length > SCALES.length) {
    throw new CheckError(`Amount is too large to write on a check: ${digits}`);
  }

  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] === 0) continue; // "one million five", not "one million zero thousand five"
    const scale = SCALES[i];
    parts.push(scale ? `${groupToWords(groups[i])} ${scale}` : groupToWords(groups[i]));
  }
  return parts.join(' ');
}

/**
 * The legal amount line: "One thousand two hundred forty and 00/100".
 *
 * Accepts the 2- or 4-decimal strings Prisma returns for Decimal(19,4).
 * Rejects negatives (a negative check is not a thing) and fractional cents
 * (unprintable — a check is a whole number of cents).
 */
export function amountToWords(amount: string): string {
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(amount.trim());
  if (!match) {
    throw new CheckError(`Amount must be a non-negative decimal: "${amount}"`);
  }
  const frac = (match[2] ?? '').padEnd(4, '0');
  if (frac.slice(2) !== '00') {
    throw new CheckError(
      `Amount ${amount} has fractional cents; a check must be a whole number of cents.`,
    );
  }
  const words = `${wholeToWords(match[1])} and ${frac.slice(0, 2)}/100`;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Allocate a contiguous run of check numbers.
 *
 * Contiguity is not a simplification — check stock is physical paper in
 * sequential order in the printer tray, so a gap cannot be skipped over the
 * way a database id can. If any number in the range is spent, the whole range
 * is unprintable.
 *
 * `usedNumbers` must include voided numbers: once a number is on paper it is
 * spent regardless of what happened to that paper (spec 4.4).
 */
export function allocateCheckNumbers(
  startNumber: number,
  count: number,
  usedNumbers: Iterable<number>,
): number[] {
  if (!Number.isInteger(startNumber) || startNumber < 1) {
    throw new CheckError('Starting check number must be a positive whole number.');
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new CheckError('Select at least one check to print.');
  }

  const used = new Set(usedNumbers);
  const last = startNumber + count - 1;
  const range: number[] = [];
  for (let n = startNumber; n <= last; n++) {
    if (used.has(n)) {
      throw new CheckError(
        `Check number ${n} has already been used. Check stock is sequential, ` +
          `so the range ${startNumber}-${last} cannot be printed. ` +
          `Choose a different starting number.`,
      );
    }
    range.push(n);
  }
  return range;
}

/** A misprint burns the number only; a cancel also reverses the ledger. */
export type VoidKind = 'misprint' | 'cancel';

export interface VoidableCheck {
  status: string;
  checkNumber: number | null;
}

/**
 * Preconditions shared by both kinds of void. The kinds differ in ledger
 * impact (handled in the service), not in what may be voided.
 */
export function assertVoidable(check: VoidableCheck, _kind: VoidKind): void {
  if (check.status === 'voided') {
    throw new CheckError('This check is already voided.');
  }
  if (check.status !== 'printed') {
    throw new CheckError(
      `Only printed checks can be voided (this one is "${check.status}").`,
    );
  }
  if (check.checkNumber == null) {
    throw new CheckError('A printed check must have a number.');
  }
}
