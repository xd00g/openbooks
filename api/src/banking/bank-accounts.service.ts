import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BankAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  list(companyId: string) {
    return this.prisma.forCompany(companyId, (tx) =>
      tx.bankAccount.findMany({
        include: { account: { select: { code: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  create(
    companyId: string,
    data: {
      accountId: string;
      provider?: string;
      institution?: string;
      mask?: string;
    },
  ) {
    return this.prisma.forCompany(companyId, (tx) =>
      tx.bankAccount.create({
        data: {
          companyId,
          accountId: data.accountId,
          provider: (data.provider as never) ?? 'manual',
          institution: data.institution,
          mask: data.mask,
        },
      }),
    );
  }

  transactions(companyId: string, bankAccountId: string, status?: string) {
    return this.prisma.forCompany(companyId, (tx) =>
      tx.bankTransaction.findMany({
        where: { bankAccountId, ...(status ? { status: status as never } : {}) },
        orderBy: { postedDate: 'asc' },
      }),
    );
  }
}
