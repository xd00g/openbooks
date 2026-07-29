import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface ItemInput {
  name: string;
  sku?: string;
  type?: string; // service | product | bundle
  description?: string;
  unitPrice?: string;
  incomeAccountId?: string;
  expenseAccountId?: string;
  isActive?: boolean;
}

/** Products & services used on invoices and bills. */
@Injectable()
export class ItemsService {
  constructor(private readonly prisma: PrismaService) {}

  list(companyId: string) {
    return this.prisma.forCompany(companyId, (tx) =>
      tx.item.findMany({ orderBy: { name: 'asc' } }),
    );
  }

  create(companyId: string, data: ItemInput) {
    return this.prisma.forCompany(companyId, (tx) =>
      tx.item.create({ data: { companyId, ...(data as any) } }),
    );
  }

  update(companyId: string, id: string, data: Partial<ItemInput>) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const it = await tx.item.findFirst({ where: { id } });
      if (!it) throw new NotFoundException('Item not found.');
      return tx.item.update({ where: { id }, data: data as any });
    });
  }
}
