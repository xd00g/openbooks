import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { AccountResolverService } from '../accounts/account-resolver.service';
import { buildInvoicePosting } from './posting.builders';

@Injectable()
export class InvoicePostingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly accounts: AccountResolverService,
  ) {}

  /**
   * Post a finalized invoice to the GL:
   *   Dr Accounts Receivable / Cr Income (+ Cr Sales Tax Payable)
   * Idempotent guard: refuses if the invoice already has a journal entry.
   */
  async post(companyId: string, invoiceId: string, createdById?: string) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id: invoiceId },
        include: {
          lines: true,
          taxLines: { include: { taxRate: true } },
        },
      });
      if (!invoice) throw new NotFoundException('Invoice not found.');
      if (invoice.journalEntryId) {
        throw new ConflictException('Invoice is already posted.');
      }

      const ar = await this.accounts.bySubtype(
        tx,
        companyId,
        'accounts_receivable',
      );

      const lines = buildInvoicePosting({
        arAccountId: ar.id,
        customerId: invoice.customerId,
        lines: invoice.lines.map((l) => ({
          accountId: l.accountId,
          amount: l.amount.toString(),
        })),
        taxLines: invoice.taxLines.map((t) => ({
          liabilityAccountId: t.taxRate.liabilityAccountId,
          taxAmount: t.taxAmount.toString(),
        })),
      });

      const entryId = await this.ledger.createPostedEntry(tx, {
        companyId,
        entryDate: invoice.issueDate,
        sourceType: 'invoice',
        sourceId: invoice.id,
        currency: invoice.currency,
        memo: `Invoice ${invoice.number}`,
        createdById,
        lines,
      });

      await tx.invoice.update({
        where: { id: invoice.id },
        data: { journalEntryId: entryId, status: 'open' },
      });

      return { entryId };
    });
  }
}
