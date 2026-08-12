import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PayrollPostingService } from '../posting/payroll-posting.service';
import { LedgerService } from '../ledger/ledger.service';
import { EncryptionService } from '../common/crypto/encryption.service';
import { PrismaClient } from '@prisma/client';
import {
  PayrollError,
  PayrollLineInput,
  computeGross,
  computeRunTotals,
  normalizePayrollLine,
} from './payroll.logic';

interface EmployeeInput {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  address?: any;
  ssn?: string; // stored encrypted as ssnEncrypted
  bankAccount?: string; // stored encrypted as bankAccountEncrypted
  payType?: string; // hourly | salary
  payRate?: string;
  filingStatus?: string;
  hireDate?: string;
}

interface RunInput {
  payDate: string;
  periodStart: string;
  periodEnd: string;
  periodsPerYear?: number; // for salaried gross = annual / periods (default 26)
  lines: PayrollLineInput[];
}

@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: PayrollPostingService,
    private readonly ledger: LedgerService,
    private readonly enc: EncryptionService,
  ) {}

  /** Delete a DRAFT payroll run (no GL impact yet). Posted runs must be voided. */
  deleteRun(companyId: string, id: string) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const run = await tx.payrollRun.findFirst({ where: { id } });
      if (!run) throw new NotFoundException('Payroll run not found.');
      if (run.status !== 'draft') {
        throw new BadRequestException('Only draft runs can be deleted; void a posted run instead.');
      }
      await tx.payrollRun.delete({ where: { id } });
      return { deleted: true };
    });
  }

  /** Void a posted payroll run by reversing its journal entry (audit-preserving). */
  voidRun(companyId: string, id: string, userId?: string) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const run = await tx.payrollRun.findFirst({ where: { id } });
      if (!run) throw new NotFoundException('Payroll run not found.');
      if (run.status === 'void') throw new BadRequestException('Run is already void.');
      if (run.status !== 'posted') throw new BadRequestException('Only posted runs can be voided.');
      if (run.journalEntryId) {
        await this.ledger.reverseEntry(tx, companyId, run.journalEntryId, new Date(), userId);
      }
      await tx.payrollRun.update({ where: { id }, data: { status: 'void' } });
      return { voided: true };
    });
  }

  // --- Employees -----------------------------------------------------------

  /** Map EmployeeInput to DB columns, encrypting secret fields (SSN, bank acct). */
  private toEmployeeData(data: Partial<EmployeeInput>) {
    const d: Record<string, unknown> = {};
    for (const k of ['firstName', 'lastName', 'email', 'phone', 'payType', 'payRate', 'filingStatus'] as const) {
      if (data[k] !== undefined) d[k] = data[k];
    }
    if (data.address !== undefined) d.address = data.address;
    if (data.hireDate !== undefined) d.hireDate = data.hireDate ? new Date(data.hireDate) : null;
    if (data.ssn !== undefined) d.ssnEncrypted = this.enc.encrypt(data.ssn);
    if (data.bankAccount !== undefined) d.bankAccountEncrypted = this.enc.encrypt(data.bankAccount);
    return d;
  }

  createEmployee(companyId: string, data: EmployeeInput) {
    return this.prisma.forCompany(companyId, (tx) =>
      tx.employee.create({ data: { companyId, ...(this.toEmployeeData(data) as any) } }),
    );
  }

  listEmployees(companyId: string) {
    return this.prisma.forCompany(companyId, (tx) =>
      tx.employee.findMany({ orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] }),
    );
  }

  updateEmployee(companyId: string, id: string, data: Partial<EmployeeInput>) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const emp = await tx.employee.findFirst({ where: { id } });
      if (!emp) throw new NotFoundException('Employee not found.');
      return tx.employee.update({
        where: { id },
        data: this.toEmployeeData(data) as any,
      });
    });
  }

  // --- Payroll runs --------------------------------------------------------

  /** Create a DRAFT run with normalized, validated lines and computed totals. */
  /** Fill in `gross` from each employee's pay setup for lines that omit it
   *  (hourly: rate x hours; salary: annual / periods). Lines that provide an
   *  explicit gross are left untouched. */
  private async resolveGross(
    tx: PrismaClient,
    lines: PayrollLineInput[],
    periodsPerYear?: number,
  ): Promise<PayrollLineInput[]> {
    const emps = await tx.employee.findMany({
      where: { id: { in: lines.map((l) => l.employeeId) } },
      select: { id: true, payType: true, payRate: true },
    });
    const byId = new Map(emps.map((e) => [e.id, e]));
    return lines.map((l) => {
      if (l.gross != null && l.gross !== '') return l;
      const e = byId.get(l.employeeId);
      if (!e) return l;
      return {
        ...l,
        gross: computeGross({
          payType: e.payType,
          payRate: e.payRate?.toString() ?? '0',
          hours: l.hours,
          periodsPerYear,
        }),
      };
    });
  }

  async createRun(companyId: string, input: RunInput) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const resolved = await this.resolveGross(tx, input.lines, input.periodsPerYear);
      const normalized = this.normalize(resolved);
      const totals = computeRunTotals(normalized);
      return tx.payrollRun.create({
        data: {
          companyId,
          payDate: new Date(input.payDate),
          periodStart: new Date(input.periodStart),
          periodEnd: new Date(input.periodEnd),
          status: 'draft',
          grossTotal: totals.grossTotal,
          netTotal: totals.netTotal,
          lines: {
            create: normalized.map((l) => ({
              companyId,
              employeeId: l.employeeId,
              gross: l.gross,
              employeeTaxes: l.employeeTaxes,
              employerTaxes: l.employerTaxes,
              deductions: l.deductions,
              net: l.net,
            })),
          },
        },
        include: { lines: true },
      });
    });
  }

  /** Replace the lines/fields of a DRAFT run. Posted runs are immutable. */
  async updateRun(companyId: string, runId: string, input: Partial<RunInput>) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const run = await tx.payrollRun.findFirst({ where: { id: runId } });
      if (!run) throw new NotFoundException('Payroll run not found.');
      if (run.status !== 'draft') {
        throw new ConflictException('Only draft runs can be edited.');
      }

      let grossTotal = run.grossTotal.toString();
      let netTotal = run.netTotal.toString();

      if (input.lines) {
        const resolved = await this.resolveGross(tx, input.lines, input.periodsPerYear);
        const normalized = this.normalize(resolved);
        const totals = computeRunTotals(normalized);
        grossTotal = totals.grossTotal;
        netTotal = totals.netTotal;
        await tx.payrollLine.deleteMany({ where: { payrollRunId: runId } });
        await tx.payrollLine.createMany({
          data: normalized.map((l) => ({
            companyId,
            payrollRunId: runId,
            employeeId: l.employeeId,
            gross: l.gross,
            employeeTaxes: l.employeeTaxes,
            employerTaxes: l.employerTaxes,
            deductions: l.deductions,
            net: l.net,
          })),
        });
      }

      return tx.payrollRun.update({
        where: { id: runId },
        data: {
          payDate: input.payDate ? new Date(input.payDate) : undefined,
          periodStart: input.periodStart ? new Date(input.periodStart) : undefined,
          periodEnd: input.periodEnd ? new Date(input.periodEnd) : undefined,
          grossTotal,
          netTotal,
        },
        include: { lines: true },
      });
    });
  }

  getRun(companyId: string, id: string) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const run = await tx.payrollRun.findFirst({
        where: { id },
        include: { lines: true },
      });
      if (!run) throw new NotFoundException('Payroll run not found.');
      return run;
    });
  }

  listRuns(companyId: string) {
    return this.prisma.forCompany(companyId, (tx) =>
      tx.payrollRun.findMany({ orderBy: { payDate: 'desc' } }),
    );
  }

  /** Finalize -> post the run to the GL (wage/tax expense, cash, liabilities). */
  finalizeRun(companyId: string, runId: string, userId?: string) {
    return this.posting.post(companyId, runId, userId);
  }

  private normalize(lines: PayrollLineInput[]) {
    if (!lines?.length) {
      throw new BadRequestException('A payroll run needs at least one line.');
    }
    try {
      return lines.map(normalizePayrollLine);
    } catch (e) {
      if (e instanceof PayrollError) throw new BadRequestException(e.message);
      throw e;
    }
  }
}
