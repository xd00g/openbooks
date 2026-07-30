import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';

export interface VendorInput {
  displayName: string;
  companyName?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  fax?: string;
  website?: string;
  address?: any;
  is1099?: boolean;
  taxId?: string;
  isActive?: boolean;
}

import { AccountResolverService } from '../accounts/account-resolver.service';
import {
  buildBillPosting,
  buildPaymentPaidPosting,
} from '../posting/posting.builders';
import {
  DocLineInput,
  DocumentError,
  allocatePayment,
  computeDocumentTotals,
} from '../documents/document.logic';
import { Money } from '../ledger/money';

interface CreateBillInput {
  vendorId: string;
  number?: string;
  issueDate: string;
  dueDate?: string;
  currency?: string;
  memo?: string;
  lines: DocLineInput[]; // no tax on bills in v1 (design §12/§17)
}

interface PayBillsInput {
  vendorId: string;
  paymentDate: string;
  bankAccountId: string; // source of funds (required for paid)
  method?: string;
  reference?: string;
  /** Queue a printed check for this payment instead of recording it as already paid. */
  printLater?: boolean;
  allocations: { billId: string; amount: string }[];
}

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly accounts: AccountResolverService,
  ) {}

  createVendor(companyId: string, data: VendorInput) {
    return this.prisma.forCompany(companyId, (tx) =>
      tx.vendor.create({ data: { companyId, ...data } }),
    );
  }

  updateVendor(companyId: string, id: string, data: Partial<VendorInput>) {
    return this.prisma.forCompany(companyId, (tx) =>
      tx.vendor.update({ where: { id }, data }),
    );
  }

  listVendors(companyId: string) {
    return this.prisma.forCompany(companyId, (tx) =>
      tx.vendor.findMany({ orderBy: { displayName: 'asc' } }),
    );
  }

  async createBill(companyId: string, input: CreateBillInput) {
    return this.prisma.forCompany(companyId, async (tx) => {
      let totals;
      try {
        totals = computeDocumentTotals(input.lines); // no tax rates
      } catch (e) {
        if (e instanceof DocumentError) throw new BadRequestException(e.message);
        throw e;
      }

      return tx.bill.create({
        data: {
          companyId,
          vendorId: input.vendorId,
          number: input.number,
          status: 'draft',
          issueDate: new Date(input.issueDate),
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
          currency: input.currency ?? 'USD',
          subtotal: totals.subtotal,
          taxTotal: '0',
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
              sortOrder: i,
            })),
          },
        },
        include: { lines: true },
      });
    });
  }

  /** Finalize -> post to GL (Dr Expense / Cr AP). Idempotent. */
  async finalizeBill(companyId: string, billId: string, userId?: string) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const bill = await tx.bill.findFirst({
        where: { id: billId },
        include: { lines: true },
      });
      if (!bill) throw new NotFoundException('Bill not found.');
      if (bill.journalEntryId) throw new ConflictException('Bill already posted.');

      const ap = await this.accounts.bySubtype(tx, companyId, 'accounts_payable');
      const lines = buildBillPosting({
        apAccountId: ap.id,
        vendorId: bill.vendorId,
        lines: bill.lines.map((l) => ({
          accountId: l.accountId,
          amount: l.amount.toString(),
        })),
      });

      const entryId = await this.ledger.createPostedEntry(tx, {
        companyId,
        entryDate: bill.issueDate,
        sourceType: 'bill',
        sourceId: bill.id,
        currency: bill.currency,
        memo: `Bill ${bill.number ?? bill.id}`,
        createdById: userId,
        lines,
      });

      await tx.bill.update({
        where: { id: bill.id },
        data: { journalEntryId: entryId, status: 'open' },
      });
      return { entryId };
    });
  }

  /** Delete a DRAFT bill (no GL impact yet). Posted bills must be voided. */
  deleteBill(companyId: string, id: string) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const bill = await tx.bill.findFirst({ where: { id } });
      if (!bill) throw new NotFoundException('Bill not found.');
      if (bill.status !== 'draft') {
        throw new BadRequestException('Only draft bills can be deleted; void a posted bill instead.');
      }
      await tx.bill.delete({ where: { id } });
      return { deleted: true };
    });
  }

  /** Void a posted bill by reversing its journal entry (audit-preserving). */
  voidBill(companyId: string, id: string, userId?: string) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const bill = await tx.bill.findFirst({ where: { id } });
      if (!bill) throw new NotFoundException('Bill not found.');
      if (bill.status === 'void') throw new BadRequestException('Bill is already void.');
      if (bill.status === 'draft') throw new BadRequestException('Delete draft bills instead of voiding.');
      if (Number(bill.amountPaid) > 0) {
        throw new BadRequestException('Unapply payments before voiding this bill.');
      }
      if (bill.journalEntryId) {
        await this.ledger.reverseEntry(tx, companyId, bill.journalEntryId, new Date(), userId);
      }
      await tx.bill.update({ where: { id }, data: { status: 'void' } });
      return { voided: true };
    });
  }

  /** Undo Finalize: reverse the posted entry and put the bill back to draft
   *  (editable) — only allowed pre-payment. See sales.service.revertInvoice. */
  revertBill(companyId: string, id: string, userId?: string) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const bill = await tx.bill.findFirst({ where: { id } });
      if (!bill) throw new NotFoundException('Bill not found.');
      if (bill.status !== 'open') {
        throw new BadRequestException('Only a finalized (not yet paid) bill can be reverted to draft.');
      }
      if (Number(bill.amountPaid) > 0) {
        throw new BadRequestException('Unapply payments before reverting this bill to draft.');
      }
      if (bill.journalEntryId) {
        await this.ledger.reverseEntry(tx, companyId, bill.journalEntryId, new Date(), userId);
      }
      await tx.bill.update({ where: { id }, data: { status: 'draft', journalEntryId: null } });
      return { reverted: true };
    });
  }

  /** Edit a DRAFT bill's header + lines in place. */
  async updateBill(companyId: string, id: string, input: CreateBillInput) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const existing = await tx.bill.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException('Bill not found.');
      if (existing.status !== 'draft') {
        throw new BadRequestException('Only draft bills can be edited.');
      }

      let totals;
      try {
        totals = computeDocumentTotals(input.lines);
      } catch (e) {
        if (e instanceof DocumentError) throw new BadRequestException(e.message);
        throw e;
      }

      await tx.billLine.deleteMany({ where: { billId: id } });
      return tx.bill.update({
        where: { id },
        data: {
          vendorId: input.vendorId,
          number: input.number,
          issueDate: new Date(input.issueDate),
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
          currency: input.currency ?? existing.currency,
          subtotal: totals.subtotal,
          total: totals.total,
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
              sortOrder: i,
            })),
          },
        },
        include: { lines: true },
      });
    });
  }

  listBills(companyId: string) {
    return this.prisma.forCompany(companyId, (tx) =>
      tx.bill.findMany({ orderBy: { issueDate: 'desc' } }),
    );
  }

  getBill(companyId: string, id: string) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const bill = await tx.bill.findFirst({ where: { id }, include: { lines: true } });
      if (!bill) throw new NotFoundException('Bill not found.');
      return bill;
    });
  }

  /** A vendor's full activity: every bill + every payment, chronological, with
   *  a running balance — the basis for a vendor statement. */
  async vendorStatement(companyId: string, vendorId: string) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const vendor = await tx.vendor.findFirst({ where: { id: vendorId } });
      if (!vendor) throw new NotFoundException('Vendor not found.');

      const [bills, payments] = await Promise.all([
        tx.bill.findMany({ where: { vendorId, status: { not: 'draft' } }, orderBy: { issueDate: 'asc' } }),
        tx.payment.findMany({
          where: { vendorId, direction: 'paid' },
          include: { applications: { select: { billId: true, amount: true } } },
          orderBy: { paymentDate: 'asc' },
        }),
      ]);

      type Row = { date: Date; kind: 'bill' | 'payment'; ref: string; id: string; charge: number; payment: number };
      const rows: Row[] = [
        ...bills.map((b) => ({ date: b.issueDate, kind: 'bill' as const, ref: b.number ?? b.id.slice(0, 8), id: b.id, charge: Number(b.total), payment: 0 })),
        ...payments.map((p) => ({ date: p.paymentDate, kind: 'payment' as const, ref: p.reference ?? p.method ?? 'Payment', id: p.id, charge: 0, payment: Number(p.amount) })),
      ].sort((a, b) => a.date.getTime() - b.date.getTime());

      let running = 0;
      const withBalance = rows.map((r) => { running += r.charge - r.payment; return { ...r, balance: running.toFixed(2) }; });

      return {
        vendor: { id: vendor.id, displayName: vendor.displayName, companyName: vendor.companyName, email: vendor.email, phone: vendor.phone, address: vendor.address },
        openBills: bills.filter((b) => Number(b.balanceDue) > 0).map((b) => ({ id: b.id, number: b.number, issueDate: b.issueDate, dueDate: b.dueDate, total: b.total.toString(), balanceDue: b.balanceDue.toString() })),
        rows: withBalance,
        balance: running.toFixed(2),
      };
    });
  }

  /** Record a vendor payment, apply to bills, and post Dr AP / Cr Bank. */
  async payBills(companyId: string, input: PayBillsInput) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const billIds = input.allocations.map((a) => a.billId);
      const bills = await tx.bill.findMany({
        where: {
          id: { in: billIds },
          vendorId: input.vendorId,
          status: { in: ['open', 'partially_paid'] },
        },
        select: { id: true, total: true, balanceDue: true },
      });
      if (bills.length !== billIds.length) {
        throw new BadRequestException(
          'One or more bills are not open for this vendor.',
        );
      }

      let result;
      try {
        result = allocatePayment(
          bills.map((b) => ({ id: b.id, balanceDue: b.balanceDue.toString() })),
          input.allocations.map((a) => ({ docId: a.billId, amount: a.amount })),
        );
      } catch (e) {
        if (e instanceof DocumentError) throw new BadRequestException(e.message);
        throw e;
      }

      const ap = await this.accounts.bySubtype(tx, companyId, 'accounts_payable');
      const bank = await this.accounts.byId(tx, companyId, input.bankAccountId);

      const payment = await tx.payment.create({
        data: {
          companyId,
          direction: 'paid',
          vendorId: input.vendorId,
          paymentDate: new Date(input.paymentDate),
          amount: result.totalApplied,
          unappliedAmount: '0',
          method: input.method,
          reference: input.reference,
          depositAccountId: bank.id, // source bank account
        },
      });

      // Queue a check for printing. The number is assigned later, by a print
      // batch — not here — so a jam can't burn a number (spec 5.1).
      if (input.printLater) {
        const vendor = await tx.vendor.findFirst({
          where: { id: input.vendorId },
          select: { displayName: true },
        });
        const bankAccountRow = await tx.bankAccount.findFirst({
          where: { accountId: bank.id },
          select: { id: true },
        });
        if (!bankAccountRow) {
          throw new BadRequestException(
            'This GL account is not set up as a bank account, so checks cannot be printed from it.',
          );
        }
        await tx.check.create({
          data: {
            companyId,
            bankAccountId: bankAccountRow.id,
            paymentId: payment.id,
            status: 'queued',
            payeeName: vendor?.displayName ?? 'Vendor',
            amount: result.totalApplied,
            checkDate: new Date(input.paymentDate),
            memo: input.reference ?? null,
          },
        });
      }

      const totalById = new Map(bills.map((b) => [b.id, b.total.toString()]));
      for (const u of result.updates) {
        await tx.paymentApplication.create({
          data: {
            companyId,
            paymentId: payment.id,
            billId: u.docId,
            amount: u.applied,
          },
        });
        const amountPaid = Money.of(totalById.get(u.docId)!)
          .sub(Money.of(u.newBalance))
          .toString();
        await tx.bill.update({
          where: { id: u.docId },
          data: { balanceDue: u.newBalance, amountPaid, status: u.status },
        });
      }

      const lines = buildPaymentPaidPosting({
        bankAccountId: bank.id,
        apAccountId: ap.id,
        amount: result.totalApplied,
        vendorId: input.vendorId,
      });
      const entryId = await this.ledger.createPostedEntry(tx, {
        companyId,
        entryDate: input.paymentDate,
        sourceType: 'payment',
        sourceId: payment.id,
        memo: 'Vendor payment',
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
