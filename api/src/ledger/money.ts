/**
 * Money — exact fixed-point arithmetic for accounting.
 *
 * Backed by a bigint of "micros" = value scaled by 10^4 (matches the DB's
 * NUMERIC(19,4)). No floating point ever touches a monetary amount. See
 * docs/DESIGN.md §4.1.
 *
 * Construct from strings (preferred) or numbers. Serialize with toString() to
 * feed Prisma Decimal fields.
 */

const SCALE = 4;
const SCALE_FACTOR = 10n ** BigInt(SCALE); // 10000n

/** Half-up division for bigints. denominator must be > 0. */
function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const neg = numerator < 0n;
  const n = neg ? -numerator : numerator;
  const q = n / denominator;
  const r = n % denominator;
  const rounded = r * 2n >= denominator ? q + 1n : q;
  return neg ? -rounded : rounded;
}

/** Parse a decimal string to a scaled bigint at `decimals` places (half-up). */
export function parseScaled(value: string, decimals: number): bigint {
  const s = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) {
    throw new Error(`Invalid decimal string: "${value}"`);
  }
  const neg = s.startsWith('-');
  const abs = neg ? s.slice(1) : s;
  const [intPart, fracPart = ''] = abs.split('.');
  const fixed = fracPart.slice(0, decimals).padEnd(decimals, '0');
  let scaled = BigInt(intPart) * 10n ** BigInt(decimals) + BigInt(fixed || '0');
  // half-up rounding using the first dropped digit
  if (fracPart.length > decimals && Number(fracPart[decimals]) >= 5) {
    scaled += 1n;
  }
  return neg ? -scaled : scaled;
}

export class Money {
  private constructor(private readonly micros: bigint) {}

  static readonly ZERO = new Money(0n);

  static fromMicros(micros: bigint): Money {
    return new Money(micros);
  }

  static of(value: string | number): Money {
    const s = typeof value === 'number' ? value.toFixed(6) : value;
    return new Money(parseScaled(s, SCALE));
  }

  add(other: Money): Money {
    return new Money(this.micros + other.micros);
  }

  sub(other: Money): Money {
    return new Money(this.micros - other.micros);
  }

  neg(): Money {
    return new Money(-this.micros);
  }

  /** Multiply by a rate (e.g. a tax rate "0.075"), rounding to 4dp half-up. */
  mulRate(rate: string | number): Money {
    const RATE_DECIMALS = 6; // schema stores tax rate as NUMERIC(9,6)
    const rateScaled = parseScaled(
      typeof rate === 'number' ? rate.toString() : rate,
      RATE_DECIMALS,
    );
    const product = this.micros * rateScaled; // scale = 4 + 6 = 10
    return new Money(divRoundHalfUp(product, 10n ** BigInt(RATE_DECIMALS)));
  }

  /**
   * Multiply by a plain decimal factor (e.g. a line quantity), rounding to 4dp
   * half-up. Same math as mulRate; named for readability at call sites.
   */
  times(factor: string | number): Money {
    return this.mulRate(factor);
  }

  isZero(): boolean {
    return this.micros === 0n;
  }

  isNegative(): boolean {
    return this.micros < 0n;
  }

  isPositive(): boolean {
    return this.micros > 0n;
  }

  eq(other: Money): boolean {
    return this.micros === other.micros;
  }

  gt(other: Money): boolean {
    return this.micros > other.micros;
  }

  gte(other: Money): boolean {
    return this.micros >= other.micros;
  }

  lt(other: Money): boolean {
    return this.micros < other.micros;
  }

  /** Fixed 4dp string, suitable for a Prisma Decimal(19,4) field. */
  toString(): string {
    const neg = this.micros < 0n;
    const abs = neg ? -this.micros : this.micros;
    const int = abs / SCALE_FACTOR;
    const frac = (abs % SCALE_FACTOR).toString().padStart(SCALE, '0');
    return `${neg ? '-' : ''}${int}.${frac}`;
  }

  toNumber(): number {
    return Number(this.toString());
  }

  /** Sum a list of Money (empty => ZERO). */
  static sum(values: Money[]): Money {
    return values.reduce((acc, m) => acc.add(m), Money.ZERO);
  }
}
