import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface PaymentTermInput {
  name: string;
  dueInDays?: number;
  discountPercent?: string;
  discountDays?: number;
  isActive?: boolean;
}

@Injectable()
export class PaymentTermsService {
  constructor(private readonly prisma: PrismaService) {}

  list(companyId: string) {
    return this.prisma.forCompany(companyId, (tx) =>
      tx.paymentTerm.findMany({ orderBy: { name: 'asc' } }),
    );
  }

  /** Coerce form strings to the right DB types (Int columns, nullable). */
  private clean(data: Partial<PaymentTermInput>) {
    const d: Record<string, unknown> = {};
    if (data.name !== undefined) d.name = data.name;
    if (data.isActive !== undefined) d.isActive = data.isActive;
    if (data.dueInDays !== undefined && (data.dueInDays as any) !== '') d.dueInDays = Number(data.dueInDays);
    if (data.discountDays !== undefined) d.discountDays = (data.discountDays as any) === '' ? null : Number(data.discountDays);
    if (data.discountPercent !== undefined) d.discountPercent = (data.discountPercent as any) === '' ? null : data.discountPercent;
    return d;
  }

  create(companyId: string, data: PaymentTermInput) {
    return this.prisma.forCompany(companyId, (tx) =>
      tx.paymentTerm.create({ data: { companyId, name: data.name, ...this.clean(data) } as any }),
    );
  }

  update(companyId: string, id: string, data: Partial<PaymentTermInput>) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const t = await tx.paymentTerm.findFirst({ where: { id } });
      if (!t) throw new NotFoundException('Payment term not found.');
      return tx.paymentTerm.update({ where: { id }, data: this.clean(data) as any });
    });
  }
}
