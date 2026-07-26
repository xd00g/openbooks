import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PayrollPostingService } from '../posting/payroll-posting.service';
import {
  PayrollError,
  PayrollLineInput,
  computeRunTotals,
  normalizePayrollLine,
} from './payroll.logic';

interface EmployeeInput {
  firstName: string;
  lastName: string;
  email?: string;
  payType?: string;
  payRate?: string;
  filingStatus?: string;
  hireDate?: string;
}

interface RunInput {
  payDate: string;
  periodStart: string;
  periodEnd: string;
  lines: PayrollLineInput[];
}

@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: PayrollPostingService,
  ) {}

  // --- Employees -----------------------------------------------------------

  createEmployee(companyId: string, data: EmployeeInput) {
    return this.prisma.forCompany(companyId, (tx) =>
      tx.employee.create({
        data: {
          companyId,
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          payType: data.payType,
          payRate: data.payRate,
          filingStatus: data.filingStatus,
          hireDate: data.hireDate ? new Date(data.hireDate) : null,
        },
      }),
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
        data: {
          ...data,
          hireDate: data.hireDate ? new Date(data.hireDate) : undefined,
        },
      });
    });
  }

  // --- Payroll runs --------------------------------------------------------

  /** Create a DRAFT run with normalized, validated lines and computed totals. */
  async createRun(companyId: string, input: RunInput) {
    const normalized = this.normalize(input.lines);
    const totals = computeRunTotals(normalized);

    return this.prisma.forCompany(companyId, (tx) =>
      tx.payrollRun.create({
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
      }),
    );
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
        const normalized = this.normalize(input.lines);
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
