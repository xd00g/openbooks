import {
  amountToWords,
  allocateCheckNumbers,
  assertVoidable,
  CheckError,
  type VoidableCheck,
} from '../check.logic';

describe('amountToWords', () => {
  it('writes a plain dollar amount', () => {
    expect(amountToWords('1240.00')).toBe(
      'One thousand two hundred forty and 00/100',
    );
  });

  it('writes zero dollars with cents', () => {
    expect(amountToWords('0.05')).toBe('Zero and 05/100');
  });

  it('writes exact millions without stray scale words', () => {
    expect(amountToWords('1000000.00')).toBe('One million and 00/100');
  });

  it('hyphenates the twenty-to-ninety-nine range', () => {
    expect(amountToWords('42.00')).toBe('Forty-two and 00/100');
  });

  it('writes teens without tens words', () => {
    expect(amountToWords('13.00')).toBe('Thirteen and 00/100');
    expect(amountToWords('19.99')).toBe('Nineteen and 99/100');
  });

  it('writes exact hundreds', () => {
    expect(amountToWords('300.00')).toBe('Three hundred and 00/100');
  });

  it('skips empty digit groups', () => {
    expect(amountToWords('1000005.00')).toBe(
      'One million five and 00/100',
    );
  });

  it('handles the largest value Decimal(19,4) allows', () => {
    expect(amountToWords('999999999999999.99')).toBe(
      'Nine hundred ninety-nine trillion nine hundred ninety-nine billion ' +
        'nine hundred ninety-nine million nine hundred ninety-nine thousand ' +
        'nine hundred ninety-nine and 99/100',
    );
  });

  it('accepts a trailing-zero 4dp string from Prisma Decimal', () => {
    expect(amountToWords('25.5000')).toBe('Twenty-five and 50/100');
  });

  it('rejects fractional cents', () => {
    expect(() => amountToWords('10.0050')).toThrow(CheckError);
  });

  it('rejects negative amounts', () => {
    expect(() => amountToWords('-5.00')).toThrow(CheckError);
  });

  it('rejects non-numeric input', () => {
    expect(() => amountToWords('abc')).toThrow(CheckError);
  });

  it('rejects a zero-value amount (0.00)', () => {
    expect(() => amountToWords('0.00')).toThrow(CheckError);
  });

  it('rejects a zero-value amount (0)', () => {
    expect(() => amountToWords('0')).toThrow(CheckError);
  });

  it('rejects a zero-value amount from Prisma (0.0000)', () => {
    expect(() => amountToWords('0.0000')).toThrow(CheckError);
  });

  it('accepts the smallest valid amount (0.01)', () => {
    expect(amountToWords('0.01')).toBe('Zero and 01/100');
  });
});

describe('allocateCheckNumbers', () => {
  it('returns a contiguous range', () => {
    expect(allocateCheckNumbers(1001, 3, [])).toEqual([1001, 1002, 1003]);
  });

  it('allocates a single check', () => {
    expect(allocateCheckNumbers(500, 1, [])).toEqual([500]);
  });

  it('allows a start that is not adjacent to previous numbers', () => {
    expect(allocateCheckNumbers(2000, 2, [1001, 1002])).toEqual([2000, 2001]);
  });

  it('refuses a range colliding with a used number', () => {
    expect(() => allocateCheckNumbers(1001, 3, [1002])).toThrow(CheckError);
  });

  it('refuses when the collision is a voided number', () => {
    // Voided numbers stay spent — the paper was printed (spec 4.4).
    expect(() => allocateCheckNumbers(1001, 1, [1001])).toThrow(CheckError);
  });

  it('names the offending number in the error', () => {
    expect(() => allocateCheckNumbers(1001, 3, [1003])).toThrow(/1003/);
  });

  it('rejects a non-positive start', () => {
    expect(() => allocateCheckNumbers(0, 1, [])).toThrow(CheckError);
  });

  it('rejects a non-integer start', () => {
    expect(() => allocateCheckNumbers(10.5, 1, [])).toThrow(CheckError);
  });

  it('rejects an empty batch', () => {
    expect(() => allocateCheckNumbers(1001, 0, [])).toThrow(CheckError);
  });
});

describe('assertVoidable', () => {
  const printed: VoidableCheck = { status: 'printed', checkNumber: 1001 };

  it('permits voiding a printed check as a misprint', () => {
    expect(() => assertVoidable(printed, 'misprint')).not.toThrow();
  });

  it('permits cancelling a printed check', () => {
    expect(() => assertVoidable(printed, 'cancel')).not.toThrow();
  });

  it('refuses to void an already-voided check', () => {
    expect(() =>
      assertVoidable({ status: 'voided', checkNumber: 1001 }, 'cancel'),
    ).toThrow(CheckError);
  });

  it('refuses to void a queued check that was never printed', () => {
    expect(() =>
      assertVoidable({ status: 'queued', checkNumber: null }, 'cancel'),
    ).toThrow(CheckError);
  });

  it('refuses a printed check with no number', () => {
    expect(() =>
      assertVoidable({ status: 'printed', checkNumber: null }, 'cancel'),
    ).toThrow(CheckError);
  });
});
