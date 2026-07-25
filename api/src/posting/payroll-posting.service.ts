import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AccountSubtype, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { AccountResolverService } from '../accounts/account-resolver.service';
import { PayrollAccounts, buildPayrollPosting } from './posting.builders';

@Injectable()
export class PayrollPostingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly accounts: AccountResolverService,
  ) {}

  /**
   * Post a (manual/light) payroll run. All figures are entered by the user;
   * no tax is computed here (docs/DESIGN.md §12). Mapping in posting.builders.
   */
  async post(companyId: string, payrollRunId: string, createdById?: string) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const run = await tx.payrollRun.findUnique({
        where: { id: payrollRunId },
        include: { lines: true },
      });
      if (!run) throw new NotFoundException('Payroll run not found.');
      if (run.journalEntryId) {
        throw new ConflictException('Payroll run is already posted.');
      }

      const accounts = await this.resolvePayrollAccounts(tx, companyId);

      const lines = buildPayrollPosting(
        accounts,
        run.lines.map((l) => ({
          employeeId: l.employeeId,
          gross: l.gross.toString(),
          employeeTaxes: l.employeeTaxes.toString(),
          employerTaxes: l.employerTaxes.toString(),
          deductions: l.deductions.toString(),
          net: l.net.toString(),
        })),
      );

      const entryId = await this.ledger.createPostedEntry(tx, {
        companyId,
        entryDate: run.payDate,
        sourceType: 'payroll',
        sourceId: run.id,
        memo: `Payroll ${run.payDate.toISOString().slice(0, 10)}`,
        createdById,
        lines,
      });

      await tx.payrollRun.update({
        where: { id: run.id },
        data: { journalEntryId: entryId, status: 'posted' },
      });

      return { entryId };
    });
  }

  /**
   * Resolve the six payroll accounts. Prefers explicit ids in
   * company.settings.payrollAccounts; falls back to CoA subtype lookups.
   */
  private async resolvePayrollAccounts(
    tx: PrismaClient,
    companyId: string,
  ): Promise<PayrollAccounts> {
    const company = await tx.company.findUnique({
      where: { id: companyId },
      select: { settings: true },
    });
    const cfg =
      (company?.settings as Record<string, any>)?.payrollAccounts ?? {};

    const bySubtype = async (subtype: AccountSubtype) =>
      (await this.accounts.bySubtype(tx, companyId, subtype)).id;
    const pick = async (key: string, subtype: AccountSubtype) =>
      cfg[key]
        ? (await this.accounts.byId(tx, companyId, cfg[key])).id
        : await bySubtype(subtype);

    return {
      wageExpenseId: await pick('wageExpenseId', 'expense'),
      employerTaxExpenseId: await pick('employerTaxExpenseId', 'expense'),
      cashAccountId: await pick('cashAccountId', 'bank'),
      employeeTaxLiabilityId: await pick(
        'employeeTaxLiabilityId',
        'payroll_liability',
      ),
      deductionsLiabilityId: await pick(
        'deductionsLiabilityId',
        'payroll_liability',
      ),
      employerTaxLiabilityId: await pick(
        'employerTaxLiabilityId',
        'payroll_liability',
      ),
    };
  }
}
