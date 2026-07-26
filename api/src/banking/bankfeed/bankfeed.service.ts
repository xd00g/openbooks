import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NormalizedTxn } from './provider.interface';
import { parseCsv, parseOfx, CsvMapping } from './bankfeed.logic';
import { SimpleFinProvider } from './simplefin.provider';

export interface ImportSummary {
  imported: number;
  skipped: number; // already present (idempotent)
  total: number;
}

/**
 * Imports normalized transactions into bank_transaction, idempotently
 * (unique on bankAccountId + externalId). New rows start as `unmatched`, ready
 * for categorization and reconciliation (docs/DESIGN.md §5.4, §9).
 */
@Injectable()
export class BankFeedService {
  constructor(private readonly prisma: PrismaService) {}

  async importCsv(
    companyId: string,
    bankAccountId: string,
    content: string,
    mapping?: CsvMapping,
  ) {
    return this.importNormalized(companyId, bankAccountId, parseCsv(content, mapping));
  }

  async importOfx(companyId: string, bankAccountId: string, content: string) {
    return this.importNormalized(companyId, bankAccountId, parseOfx(content));
  }

  /** Pull from SimpleFIN using the account's stored access URL. */
  async syncSimpleFin(companyId: string, bankAccountId: string, since?: string) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const bank = await tx.bankAccount.findFirst({
        where: { id: bankAccountId },
        select: { accessToken: true, externalId: true, lastSyncedAt: true },
      });
      if (!bank) throw new NotFoundException('Bank account not found.');
      if (!bank.accessToken) {
        throw new NotFoundException('Bank account is not linked to SimpleFIN.');
      }

      const provider = new SimpleFinProvider();
      const txns = await provider.fetchTransactions({
        accessToken: bank.accessToken, // NOTE: decrypt at the app layer (design §13)
        externalAccountId: bank.externalId ?? undefined,
        since: since ?? bank.lastSyncedAt?.toISOString().slice(0, 10),
      });

      const summary = await this.persist(tx, companyId, bankAccountId, txns);
      await tx.bankAccount.update({
        where: { id: bankAccountId },
        data: { lastSyncedAt: new Date() },
      });
      return summary;
    });
  }

  private importNormalized(
    companyId: string,
    bankAccountId: string,
    txns: NormalizedTxn[],
  ) {
    return this.prisma.forCompany(companyId, (tx) =>
      this.persist(tx, companyId, bankAccountId, txns),
    );
  }

  private async persist(
    tx: PrismaClient,
    companyId: string,
    bankAccountId: string,
    txns: NormalizedTxn[],
  ): Promise<ImportSummary> {
    const bank = await tx.bankAccount.findFirst({
      where: { id: bankAccountId },
      select: { id: true },
    });
    if (!bank) throw new NotFoundException('Bank account not found.');

    let imported = 0;
    let skipped = 0;
    for (const t of txns) {
      const existing = await tx.bankTransaction.findFirst({
        where: { bankAccountId, externalId: t.externalId },
        select: { id: true },
      });
      if (existing) {
        skipped++;
        continue;
      }
      await tx.bankTransaction.create({
        data: {
          companyId,
          bankAccountId,
          externalId: t.externalId,
          postedDate: new Date(t.postedDate),
          amount: t.amount,
          description: t.description,
          status: 'unmatched',
          raw: (t.raw ?? {}) as object,
        },
      });
      imported++;
    }
    return { imported, skipped, total: txns.length };
  }
}
