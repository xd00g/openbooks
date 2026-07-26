import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const EDITABLE = [
  'legalName',
  'dba',
  'ein',
  'email',
  'phone',
  'addressLine1',
  'addressLine2',
  'city',
  'region',
  'postalCode',
  'country',
  'baseCurrency',
  'fiscalYearStartMonth',
] as const;

@Injectable()
export class CompanyService {
  constructor(private readonly prisma: PrismaService) {}

  async get(companyId: string) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const c = await tx.company.findUnique({ where: { id: companyId } });
      if (!c) throw new NotFoundException('Company not found.');
      return c;
    });
  }

  async update(companyId: string, body: Record<string, unknown>) {
    const data: Record<string, unknown> = {};
    for (const k of EDITABLE) if (k in body) data[k] = body[k];

    return this.prisma.forCompany(companyId, async (tx) => {
      if (body.settings && typeof body.settings === 'object') {
        const cur = await tx.company.findUnique({
          where: { id: companyId },
          select: { settings: true },
        });
        data.settings = {
          ...((cur?.settings as Prisma.JsonObject) ?? {}),
          ...(body.settings as Prisma.JsonObject),
        } as Prisma.InputJsonValue;
      }
      return tx.company.update({ where: { id: companyId }, data });
    });
  }
}
