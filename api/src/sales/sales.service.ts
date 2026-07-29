import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { AccountResolverService } from '../accounts/account-resolver.service';
import { InvoicePostingService } from '../posting/invoice-posting.service';
import { buildPaymentReceivedPosting } from '../posting/posting.builders';
import {
  DocLineInput,
  DocumentError,
  TaxRateInfo,
  allocatePayment,
  computeDocumentTotals,
} from '../documents/document.logic';
import { Money } from '../ledger/money';

export interface CustomerInput {
  displayName: string;
  companyName?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  fax?: string;
  website?: string;
  billingAddress?: any;
  shippingAddress?: any;
  notes?: string;
  isActive?: boolean;
}

interface CreateInvoiceInput {
  customerId: string;
  issueDate: string;
  dueDate?: string;
  paymentTermId?: string; // if set (and no explicit dueDate), sets dueDate = issue + term.dueInDays
  currency?: string;
  memo?: string;
  lines: DocLineInput[];
}

interface RecordPaymentInput {
  customerId: string;
  paymentDate: string;
  method?: string;
  reference?: string;
  depositAccountId?: string; // bank; defaults to Undeposited Funds
  allocations: { invoiceId: string; amount: string }[];
}

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly accounts: AccountResolverService,
    private readonly invoicePosting: InvoicePostingService,
  ) {}

  createCustomer(companyId: string, data: CustomerInput) {
    return this.prisma.forCompany(companyId, (tx) =>
      tx.customer.create({ data: { companyId, ...data } }),
    );
  }

  updateCustomer(companyId: string, id: string, data: Partial<CustomerInput>) {
    return this.prisma.forCompany(companyId, (tx) =>
      tx.customer.update({ where: { id }, data }),
    );
  }

  listCustomers(companyId: string) {
    return this.prisma.forCompany(companyId, (tx) =>
      tx.customer.findMany({ orderBy: { displayName: 'asc' } }),
    );
  }

  /** Create a DRAFT invoice with computed totals. Finalize posts it to the GL. */
  async createInvoice(companyId: string, input: CreateInvoiceInput) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const taxRateIds = [
        ...new Set(input.lines.map((l) => l.taxRateId).filter(Boolean)),
      ] as string[];
      const rates = await tx.taxRate.findMany({
        where: { id: { in: taxRateIds } },
        select: { id: true, rate: true, liabilityAccountId: true },
      });
      const rateMap = new Map<string, TaxRateInfo>(
        rates.map((r) => [
          r.id,
          { rate: r.rate.toString(), liabilityAccountId: r.liabilityAccountId },
        ]),
      );

      let totals;
      try {
        totals = computeDocumentTotals(input.lines, rateMap);
      } catch (e) {
        if (e instanceof DocumentError) throw new BadRequestException(e.message);
        throw e;
      }

      // Number off the highest existing invoice, not the count — count+1 collides
      // after any invoice is deleted/voided.
      const last = await tx.invoice.findFirst({
        orderBy: { number: 'desc' },
        select: { number: true },
      });
      const lastNum = last ? parseInt(last.number.replace(/\D/g, ''), 10) || 0 : 0;
      const number = `INV-${String(lastNum + 1).padStart(4, '0')}`;

      // Payment term -> due date (unless an explicit dueDate was given).
      let dueDate = input.dueDate ? new Date(input.dueDate) : null;
      if (!dueDate && input.paymentTermId) {
        const term = await tx.paymentTerm.findFirst({ where: { id: input.paymentTermId } });
        if (term) {
          dueDate = new Date(input.issueDate);
          dueDate.setDate(dueDate.getDate() + term.dueInDays);
        }
      }

      return tx.invoice.create({
        data: {
          companyId,
          customerId: input.customerId,
          number,
          status: 'draft',
          issueDate: new Date(input.issueDate),
          dueDate,
          paymentTermId: input.paymentTermId ?? null,
          currency: input.currency ?? 'USD',
          subtotal: totals.subtotal,
          taxTotal: totals.taxTotal,
          total: totals.total,
          amountPaid: '0',
          balanceDue: totals.total,
          memo: input.memo,
          lines: {
            create: totals.lines.map((l, i) => ({
              companyId,
              accountId: l.accountId,
              itemId: l.itemId ?? null,
              description: l.description,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              amount: l.amount,
              taxRateId: l.taxRateId ?? null,
              sortOrder: i,
            })),
          },
          taxLines: {
            create: totals.taxLines.map((t) => ({
              companyId,
              taxRateId: t.taxRateId,
              taxable: t.taxable,
              taxAmount: t.taxAmount,
            })),
          },
        },
        include: { lines: true, taxLines: true },
      });
    });
  }

  /** Finalize -> post to GL (Dr AR / Cr Income + Sales Tax). Idempotent. */
  finalizeInvoice(companyId: string, invoiceId: string, userId?: string) {
    return this.invoicePosting.post(companyId, invoiceId, userId);
  }

  /** Delete a DRAFT invoice (no GL impact yet). Posted invoices must be voided. */
  deleteInvoice(companyId: string, id: string) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const inv = await tx.invoice.findFirst({ where: { id } });
      if (!inv) throw new NotFoundException('Invoice not found.');
      if (inv.status !== 'draft') {
        throw new BadRequestException('Only draft invoices can be deleted; void a posted invoice instead.');
      }
      await tx.invoice.delete({ where: { id } });
      return { deleted: true };
    });
  }

  /** Void a posted invoice by reversing its journal entry (audit-preserving). */
  voidInvoice(companyId: string, id: string, userId?: string) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const inv = await tx.invoice.findFirst({ where: { id } });
      if (!inv) throw new NotFoundException('Invoice not found.');
      if (inv.status === 'void') throw new BadRequestException('Invoice is already void.');
      if (inv.status === 'draft') throw new BadRequestException('Delete draft invoices instead of voiding.');
      if (Number(inv.amountPaid) > 0) {
        throw new BadRequestException('Unapply payments before voiding this invoice.');
      }
      if (inv.journalEntryId) {
        await this.ledger.reverseEntry(tx, companyId, inv.journalEntryId, new Date(), userId);
      }
      await tx.invoice.update({ where: { id }, data: { status: 'void' } });
      return { voided: true };
    });
  }

  getInvoice(companyId: string, id: string) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const inv = await tx.invoice.findFirst({
        where: { id },
        include: { lines: true, taxLines: true, applications: true },
      });
      if (!inv) throw new NotFoundException('Invoice not found.');
      return inv;
    });
  }

  listInvoices(companyId: string) {
    return this.prisma.forCompany(companyId, (tx) =>
      tx.invoice.findMany({ orderBy: { number: 'desc' } }),
    );
  }

  /**
   * Record a customer payment, apply it across invoices (keeping balanceDue and
   * status accurate), and post it to the GL. This is what closes the AR-aging
   * "balanceDue may be stale" caveat.
   */
  async recordPayment(companyId: string, input: RecordPaymentInput) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const invoiceIds = input.allocations.map((a) => a.invoiceId);
      const invoices = await tx.invoice.findMany({
        where: {
          id: { in: invoiceIds },
          customerId: input.customerId,
          status: { in: ['open', 'partially_paid'] },
        },
        select: { id: true, total: true, balanceDue: true },
      });
      if (invoices.length !== invoiceIds.length) {
        throw new BadRequestException(
          'One or more invoices are not open for this customer.',
        );
      }

      let result;
      try {
        result = allocatePayment(
          invoices.map((i) => ({ id: i.id, balanceDue: i.balanceDue.toString() })),
          input.allocations.map((a) => ({ docId: a.invoiceId, amount: a.amount })),
        );
      } catch (e) {
        if (e instanceof DocumentError) throw new BadRequestException(e.message);
        throw e;
      }

      const ar = await this.accounts.bySubtype(tx, companyId, 'accounts_receivable');
      const deposit = input.depositAccountId
        ? await this.accounts.byId(tx, companyId, input.depositAccountId)
        : await this.accounts.bySubtype(tx, companyId, 'undeposited_funds');

      const payment = await tx.payment.create({
        data: {
          companyId,
          direction: 'received',
          customerId: input.customerId,
          paymentDate: new Date(input.paymentDate),
          amount: result.totalApplied,
          unappliedAmount: '0',
          method: input.method,
          reference: input.reference,
          depositAccountId: deposit.id,
        },
      });

      const totalById = new Map(invoices.map((i) => [i.id, i.total.toString()]));
      for (const u of result.updates) {
        await tx.paymentApplication.create({
          data: {
            companyId,
            paymentId: payment.id,
            invoiceId: u.docId,
            amount: u.applied,
          },
        });
        const amountPaid = Money.of(totalById.get(u.docId)!)
          .sub(Money.of(u.newBalance))
          .toString();
        await tx.invoice.update({
          where: { id: u.docId },
          data: { balanceDue: u.newBalance, amountPaid, status: u.status },
        });
      }

      const lines = buildPaymentReceivedPosting({
        depositAccountId: deposit.id,
        arAccountId: ar.id,
        amount: result.totalApplied,
        customerId: input.customerId,
      });
      const entryId = await this.ledger.createPostedEntry(tx, {
        companyId,
        entryDate: input.paymentDate,
        sourceType: 'payment',
        sourceId: payment.id,
        memo: 'Customer payment',
        lines,
      });
      await tx.payment.update({
        where: { id: payment.id },
        data: { journalEntryId: entryId },
      });

      return { paymentId: payment.id, entryId, applied: result.updates };
    });
  }
}
