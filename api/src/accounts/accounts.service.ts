import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  list(companyId: string) {
    return this.prisma.forCompany(companyId, (tx) =>
      tx.account.findMany({ orderBy: { code: 'asc' } }),
    );
  }

  create(
    companyId: string,
    data: {
      code: string;
      name: string;
      type: string;
      subtype: string;
      parentId?: string;
    },
  ) {
    return this.prisma.forCompany(companyId, (tx) =>
      tx.account.create({
        data: {
          companyId,
          code: data.code,
          name: data.name,
          type: data.type as never,
          subtype: data.subtype as never,
          parentId: data.parentId ?? null,
        },
      }),
    );
  }
}
