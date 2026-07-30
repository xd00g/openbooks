import { amountToWords, CheckError } from '../check.logic';

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
});
