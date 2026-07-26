/**
 * Pure payroll math (light payroll — docs/DESIGN.md §12). All figures are
 * user-entered; nothing here computes withholding. We enforce the payroll
 * identity and compute run totals. No DB.
 */
import { Money } from '../ledger/money';

export class PayrollError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayrollError';
  }
}

export interface PayrollLineInput {
  employeeId: string;
  gross: string;
  employeeTaxes?: string;
  employerTaxes?: string;
  deductions?: string;
  net?: string; // if omitted, computed as gross - employeeTaxes - deductions
}

export interface NormalizedPayrollLine {
  employeeId: string;
  gross: string;
  employeeTaxes: string;
  employerTaxes: string;
  deductions: string;
  net: string;
}

/**
 * Normalize a line: default missing amounts to 0, compute net if absent, and
 * enforce  gross = net + employeeTaxes + deductions  (the identity the GL
 * posting relies on). All amounts must be non-negative.
 */
export function normalizePayrollLine(
  input: PayrollLineInput,
): NormalizedPayrollLine {
  const gross = Money.of(input.gross);
  const employeeTaxes = Money.of(input.employeeTaxes ?? '0');
  const employerTaxes = Money.of(input.employerTaxes ?? '0');
  const deductions = Money.of(input.deductions ?? '0');

  for (const [name, m] of [
    ['gross', gross],
    ['employeeTaxes', employeeTaxes],
    ['employerTaxes', employerTaxes],
    ['deductions', deductions],
  ] as const) {
    if (m.isNegative()) {
      throw new PayrollError(`${name} cannot be negative (employee ${input.employeeId}).`);
    }
  }

  const computedNet = gross.sub(employeeTaxes).sub(deductions);
  const net = input.net !== undefined ? Money.of(input.net) : computedNet;

  if (!computedNet.eq(net)) {
    throw new PayrollError(
      `Employee ${input.employeeId}: net (${net.toString()}) must equal gross - ` +
        `employeeTaxes - deductions (${computedNet.toString()}).`,
    );
  }
  if (net.isNegative()) {
    throw new PayrollError(
      `Employee ${input.employeeId}: net pay is negative.`,
    );
  }

  return {
    employeeId: input.employeeId,
    gross: gross.toString(),
    employeeTaxes: employeeTaxes.toString(),
    employerTaxes: employerTaxes.toString(),
    deductions: deductions.toString(),
    net: net.toString(),
  };
}

export interface RunTotals {
  grossTotal: string;
  employeeTaxTotal: string;
  employerTaxTotal: string;
  deductionsTotal: string;
  netTotal: string;
}

export function computeRunTotals(lines: NormalizedPayrollLine[]): RunTotals {
  return {
    grossTotal: Money.sum(lines.map((l) => Money.of(l.gross))).toString(),
    employeeTaxTotal: Money.sum(lines.map((l) => Money.of(l.employeeTaxes))).toString(),
    employerTaxTotal: Money.sum(lines.map((l) => Money.of(l.employerTaxes))).toString(),
    deductionsTotal: Money.sum(lines.map((l) => Money.of(l.deductions))).toString(),
    netTotal: Money.sum(lines.map((l) => Money.of(l.net))).toString(),
  };
}
