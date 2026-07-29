import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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

  /**
   * Step 1 of SimpleFIN linking: exchange the one-time setup token for a durable
   * access URL, remember it on the company, and return the accounts it can see
   * so the user can map each to a GL account.
   *
   * SECURITY: the access URL is a long-lived credential. It is currently stored
   * as-is (matching how bank_account.accessToken is stored today); wiring real
   * app-layer encryption for these fields is tracked as a follow-up.
   */
  async claimSimpleFin(companyId: string, setupToken: string) {
    if (!setupToken?.trim()) {
      throw new BadRequestException('SimpleFIN setup token is required.');
    }
    const accessUrl = await SimpleFinProvider.claimAccessUrl(setupToken.trim());
    const accounts = await new SimpleFinProvider().fetchAccounts(accessUrl);

    await this.prisma.forCompany(companyId, async (tx) => {
      const c = await tx.company.findUnique({
        where: { id: companyId },
        select: { settings: true },
      });
      const settings = {
        ...((c?.settings as Record<string, unknown>) ?? {}),
        simplefinAccessUrl: accessUrl,
      };
      await tx.company.update({
        where: { id: companyId },
        data: { settings: settings as never },
      });
    });

    return { accounts };
  }

  /**
   * Step 2 of SimpleFIN linking: create a bank account bound to a GL account,
   * carrying the previously-claimed access URL so syncs can run.
   */
  async linkSimpleFin(
    companyId: string,
    data: {
      externalAccountId: string;
      accountId: string;
      institution?: string;
      mask?: string;
    },
  ) {
    if (!data?.accountId) {
      throw new BadRequestException('Choose a GL account to link.');
    }
    if (!data?.externalAccountId) {
      throw new BadRequestException('Missing SimpleFIN account id.');
    }
    return this.prisma.forCompany(companyId, async (tx) => {
      const c = await tx.company.findUnique({
        where: { id: companyId },
        select: { settings: true },
      });
      const accessUrl = (c?.settings as Record<string, unknown> | null)
        ?.simplefinAccessUrl as string | undefined;
      if (!accessUrl) {
        throw new BadRequestException(
          'Connect a SimpleFIN setup token before linking accounts.',
        );
      }
      return tx.bankAccount.create({
        data: {
          companyId,
          accountId: data.accountId,
          provider: 'simplefin' as never,
          externalId: data.externalAccountId,
          accessToken: accessUrl,
          institution: data.institution,
          mask: data.mask,
        },
      });
    });
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
