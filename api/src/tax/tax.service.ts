import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccountResolverService } from '../accounts/account-resolver.service';

export interface TaxRateInput {
  name: string;
  ratePercent: string; // e.g. "7.5" -> stored as 0.075000
  agencyName?: string; // find-or-create
  isActive?: boolean;
}

/** Sales-tax agencies and rates. Rates are applied on invoice/bill lines via
 *  taxRateId; the document engine already computes the tax + liability postings. */
@Injectable()
export class TaxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountResolverService,
  ) {}

  listRates(companyId: string) {
    return this.prisma.forCompany(companyId, (tx) =>
      tx.taxRate.findMany({ include: { agency: true }, orderBy: { name: 'asc' } }),
    );
  }

  listAgencies(companyId: string) {
    return this.prisma.forCompany(companyId, (tx) =>
      tx.taxAgency.findMany({ orderBy: { name: 'asc' } }),
    );
  }

  createRate(companyId: string, data: TaxRateInput) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const agencyName = data.agencyName?.trim() || 'Sales Tax';
      let agency = await tx.taxAgency.findFirst({ where: { name: agencyName } });
      if (!agency) agency = await tx.taxAgency.create({ data: { companyId, name: agencyName } });
      const liability = await this.accounts.bySubtype(tx, companyId, 'sales_tax_payable' as never);
      return tx.taxRate.create({
        data: {
          companyId,
          agencyId: agency.id,
          name: data.name,
          rate: (Number(data.ratePercent) / 100).toFixed(6),
          liabilityAccountId: liability.id,
          isActive: data.isActive ?? true,
        },
        include: { agency: true },
      });
    });
  }

  updateRate(companyId: string, id: string, data: Partial<TaxRateInput>) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const r = await tx.taxRate.findFirst({ where: { id } });
      if (!r) throw new NotFoundException('Tax rate not found.');
      const patch: Record<string, unknown> = {};
      if (data.name !== undefined) patch.name = data.name;
      if (data.isActive !== undefined) patch.isActive = data.isActive;
      if (data.ratePercent !== undefined && data.ratePercent !== '')
        patch.rate = (Number(data.ratePercent) / 100).toFixed(6);
      return tx.taxRate.update({ where: { id }, data: patch, include: { agency: true } });
    });
  }
}
