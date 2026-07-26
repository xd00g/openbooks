import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CoaTemplate,
  REQUIRED_SUBTYPES,
  STANDARD_US_SMB,
  buildPayrollAccountSettings,
  validateCoaTemplate,
} from './coa-template';

export interface SeedResult {
  companyId: string;
  templateKey: string;
  accountsUpserted: number;
  payrollWired: boolean;
}

/**
 * Seeds a company's chart of accounts from a template. Idempotent: safe to run
 * repeatedly (upsert by [companyId, code]). Runs inside a company-scoped
 * transaction so PostgreSQL RLS lets the writes through.
 *
 * NOTE: the company row must already exist. Company creation is a separate
 * onboarding concern (and has its own RLS consideration — see docs/DESIGN.md
 * §17 open decision on company-creation privileges).
 */
@Injectable()
export class CoaSeederService {
  private readonly log = new Logger(CoaSeederService.name);

  constructor(private readonly prisma: PrismaService) {}

  async seed(
    companyId: string,
    template: CoaTemplate = STANDARD_US_SMB,
  ): Promise<SeedResult> {
    validateCoaTemplate(template); // fail fast on a bad template

    return this.prisma.forCompany(companyId, async (tx) => {
      const company = await tx.company.findUnique({
        where: { id: companyId },
        select: { id: true, settings: true },
      });
      if (!company) throw new NotFoundException('Company not found.');

      // Pass 1 — upsert every account (without parent links yet).
      for (const a of template.accounts) {
        await tx.account.upsert({
          where: { companyId_code: { companyId, code: a.code } },
          create: {
            companyId,
            code: a.code,
            name: a.name,
            type: a.type as never,
            subtype: a.subtype as never,
            isSystem: a.isSystem ?? false,
            isActive: true,
          },
          update: {
            name: a.name,
            type: a.type as never,
            subtype: a.subtype as never,
            isSystem: a.isSystem ?? false,
          },
        });
      }

      // Build a code -> id map for parent linking + payroll wiring.
      const rows = await tx.account.findMany({
        where: { companyId },
        select: { id: true, code: true, subtype: true },
      });
      const idByCode = new Map(rows.map((r) => [r.code, r.id]));

      // Pass 2 — set parent links.
      for (const a of template.accounts) {
        if (a.parentCode) {
          await tx.account.update({
            where: { companyId_code: { companyId, code: a.code } },
            data: { parentId: idByCode.get(a.parentCode) ?? null },
          });
        }
      }

      // Wire payroll accounts into company.settings so PayrollPostingService
      // resolves specific accounts instead of ambiguous subtype fallbacks.
      const payrollAccounts = buildPayrollAccountSettings(idByCode);
      const settings = {
        ...((company.settings as Prisma.JsonObject) ?? {}),
        payrollAccounts,
      };
      await tx.company.update({
        where: { id: companyId },
        data: { settings: settings as Prisma.InputJsonValue },
      });

      this.assertRequiredSubtypes(rows);

      this.log.log(
        `Seeded ${rows.length} accounts (${template.key}) for company ${companyId}`,
      );
      return {
        companyId,
        templateKey: template.key,
        accountsUpserted: rows.length,
        payrollWired: true,
      };
    });
  }

  /** Post-seed safety check: the resolver's required subtypes must all exist. */
  private assertRequiredSubtypes(
    rows: { subtype: string }[],
  ): void {
    const present = new Set(rows.map((r) => r.subtype));
    const missing = REQUIRED_SUBTYPES.filter((s) => !present.has(s));
    if (missing.length > 0) {
      throw new Error(
        `Seed incomplete — missing required subtypes: ${missing.join(', ')}`,
      );
    }
  }
}
