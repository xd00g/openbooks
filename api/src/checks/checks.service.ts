import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import {
  CheckError,
  allocateCheckNumbers,
  assertVoidable,
  type VoidKind,
} from './check.logic';
import {
  buildAlignmentTestPdf,
  buildCheckPdf,
  type CheckPdfData,
} from './check-pdf';

/** Translate pure-logic failures into HTTP 400s with their original message. */
function asHttp(e: unknown): never {
  if (e instanceof CheckError) throw new BadRequestException(e.message);
  throw e as Error;
}

@Injectable()
export class ChecksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  /** Checks waiting to be printed for one bank account. */
  listQueue(companyId: string, bankAccountId: string) {
    return this.prisma.forCompany(companyId, (tx) =>
      tx.check.findMany({
        where: { bankAccountId, status: 'queued' },
        orderBy: { checkDate: 'asc' },
      }),
    );
  }

  listHistory(companyId: string, bankAccountId: string) {
    return this.prisma.forCompany(companyId, (tx) =>
      tx.check.findMany({
        where: { bankAccountId, status: { in: ['printed', 'voided'] } },
        orderBy: { checkNumber: 'desc' },
        take: 200,
      }),
    );
  }

  /**
   * Assign a contiguous number range to the selected checks and mark them
   * printed under a new batch id. Numbers are assigned here so they can be
   * drawn on paper, but are only *committed* by confirmBatch — a misprint
   * voids them and the checks return to the queue (spec 5.1).
   */
  async startPrintBatch(
    companyId: string,
    input: { bankAccountId: string; startNumber: number; checkIds: string[] },
  ) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const checks = await tx.check.findMany({
        where: {
          id: { in: input.checkIds },
          bankAccountId: input.bankAccountId,
          status: 'queued',
        },
        orderBy: { checkDate: 'asc' },
      });
      if (checks.length !== input.checkIds.length) {
        throw new BadRequestException(
          'One or more selected checks are no longer queued for this bank account.',
        );
      }

      // Every number ever assigned on this account, voided included (spec 4.4).
      const spent = await tx.check.findMany({
        where: { bankAccountId: input.bankAccountId, checkNumber: { not: null } },
        select: { checkNumber: true },
      });

      let numbers: number[];
      try {
        numbers = allocateCheckNumbers(
          input.startNumber,
          checks.length,
          spent.map((s) => s.checkNumber as number),
        );
      } catch (e) {
        asHttp(e);
      }

      const printBatchId = randomUUID();
      const printedAt = new Date();
      for (let i = 0; i < checks.length; i++) {
        await tx.check.update({
          where: { id: checks[i].id },
          data: {
            checkNumber: numbers[i],
            status: 'printed',
            printBatchId,
            printedAt,
          },
        });
      }

      await tx.bankAccount.update({
        where: { id: input.bankAccountId },
        data: { nextCheckNumber: numbers[numbers.length - 1] + 1 },
      });

      return {
        printBatchId,
        assigned: checks.map((c, i) => ({ checkId: c.id, checkNumber: numbers[i] })),
      };
    });
  }

  /** Render a batch. Safe to call repeatedly — it mutates nothing. */
  async batchPdf(companyId: string, printBatchId: string): Promise<Buffer> {
    const data = await this.prisma.forCompany(companyId, async (tx) => {
      const checks = await tx.check.findMany({
        where: { printBatchId, status: { not: 'voided' } },
        orderBy: { checkNumber: 'asc' },
      });
      if (checks.length === 0) throw new NotFoundException('Print batch not found.');

      const company = await tx.company.findFirst({ where: { id: companyId }, select: { legalName: true } });
      const bank = await tx.bankAccount.findFirst({
        where: { id: checks[0].bankAccountId },
        select: { printOffsetX: true, printOffsetY: true },
      });

      const out: CheckPdfData[] = [];
      for (const c of checks) {
        const applications = await tx.paymentApplication.findMany({
          where: { paymentId: c.paymentId },
          include: { bill: { select: { number: true, issueDate: true } } },
        });
        out.push({
          checkNumber: c.checkNumber as number,
          checkDate: c.checkDate.toISOString().slice(0, 10),
          payeeName: c.payeeName,
          amount: c.amount.toString(),
          memo: c.memo,
          companyName: company?.legalName ?? 'Company',
          bills: applications.map((a) => ({
            number: a.bill?.number ?? '—',
            date: (a.bill?.issueDate ?? c.checkDate).toISOString().slice(0, 10),
            amount: a.amount.toString(),
          })),
          offsetX: bank?.printOffsetX ?? 0,
          offsetY: bank?.printOffsetY ?? 0,
        });
      }
      return out;
    });

    try {
      return await buildCheckPdf(data);
    } catch (e) {
      return asHttp(e);
    }
  }

  /**
   * Commit a batch, or report a misprint. On misprint, every check from
   * `reprintFromNumber` onward has its number burned (status voided,
   * voidReason 'misprint') and is returned to the queue with a fresh row-level
   * reset. Payments and journal entries are untouched — a misprint is a paper
   * event, not an accounting one (spec 5.2).
   *
   * `confirmedAt` is the terminal marker for a committed check: once set, that
   * check is permanently out of scope for any later call on this batch (a
   * retried misprint report, a duplicate confirm, etc). Only rows still
   * `status: 'printed'` with `confirmedAt: null` — the `pending` set — are
   * ever mutated or counted here.
   */
  async confirmBatch(
    companyId: string,
    printBatchId: string,
    input: { ok: boolean; reprintFromNumber?: number },
  ) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const checks = await tx.check.findMany({
        where: { printBatchId },
        orderBy: { checkNumber: 'asc' },
      });
      if (checks.length === 0) throw new NotFoundException('Print batch not found.');

      const pending = checks.filter(
        (c) => c.status === 'printed' && c.confirmedAt == null,
      );

      // Idempotent: nothing left pending means this batch was already handled
      // (fully committed, fully requeued, or some mix) — a retry is a no-op.
      if (pending.length === 0) {
        return { committed: 0, requeued: 0, alreadyHandled: true };
      }

      // Spec 11.2: stamp the committed check number onto its Payment, so the
      // number shows up in vendor statements — those render Payment.reference
      // (`expenses.service.ts`: `p.reference ?? p.method ?? 'Payment'`).
      // Only committed checks are stamped; a misprinted number never reaches a
      // payment. A requeued check shares the same paymentId, so when it later
      // reprints and commits, this overwrites the reference with the new
      // number — which is the correct end state.
      const commit = async (c: (typeof pending)[number]) => {
        await tx.payment.update({
          where: { id: c.paymentId },
          data: { reference: `Check ${c.checkNumber}` },
        });
        await tx.check.update({
          where: { id: c.id },
          data: { confirmedAt: new Date() },
        });
      };

      if (input.ok) {
        for (const c of pending) {
          await commit(c);
        }
        return { committed: pending.length, requeued: 0, alreadyHandled: false };
      }

      const from = input.reprintFromNumber ?? (pending[0].checkNumber as number);
      const validNumbers = pending.map((c) => c.checkNumber as number);
      if (!validNumbers.includes(from)) {
        throw new BadRequestException(
          `reprintFromNumber ${from} is not a pending check number in this batch ` +
            `(valid: ${Math.min(...validNumbers)}-${Math.max(...validNumbers)}).`,
        );
      }

      let requeued = 0;
      for (const c of pending) {
        if ((c.checkNumber as number) < from) {
          // Ahead of the jam — this one printed fine, so commit it.
          await commit(c);
          continue;
        }
        await tx.check.update({
          where: { id: c.id },
          data: {
            status: 'voided',
            voidReason: 'misprint',
            voidedAt: new Date(),
          },
        });
        // A fresh queued row for the same payment, so it prints again with a
        // new number. The voided row stays as the audit trail.
        await tx.check.create({
          data: {
            companyId,
            bankAccountId: c.bankAccountId,
            paymentId: c.paymentId,
            status: 'queued',
            payeeName: c.payeeName,
            amount: c.amount,
            checkDate: c.checkDate,
            memo: c.memo,
          },
        });
        requeued++;
      }
      return { committed: pending.length - requeued, requeued, alreadyHandled: false };
    });
  }

  /**
   * True void: the check was issued but never cleared. Posts a reversing
   * journal entry (the ledger is immutable) and reopens the bills.
   */
  async voidCheck(companyId: string, checkId: string, reason: string) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const check = await tx.check.findFirst({ where: { id: checkId } });
      if (!check) throw new NotFoundException('Check not found.');

      const kind: VoidKind = 'cancel';
      try {
        assertVoidable({ status: check.status, checkNumber: check.checkNumber }, kind);
      } catch (e) {
        if (e instanceof CheckError && /already voided/.test(e.message)) {
          throw new ConflictException(e.message);
        }
        asHttp(e);
      }

      const payment = await tx.payment.findFirst({
        where: { id: check.paymentId },
        select: { id: true, journalEntryId: true },
      });
      if (!payment) throw new NotFoundException('Payment for this check not found.');
      if (!payment.journalEntryId) {
        throw new ConflictException(
          'This payment has no posted journal entry to reverse.',
        );
      }

      try {
        await this.ledger.reverseEntry(
          tx as never,
          companyId,
          payment.journalEntryId,
          new Date(),
        );
      } catch (e) {
        throw new ConflictException((e as Error).message);
      }

      // Reopen the bills this payment had settled.
      const applications = await tx.paymentApplication.findMany({
        where: { paymentId: payment.id },
      });
      for (const a of applications) {
        if (!a.billId) continue;
        const bill = await tx.bill.findFirst({ where: { id: a.billId } });
        if (!bill) continue;
        const newBalance = bill.balanceDue.add(a.amount);
        const newPaid = bill.amountPaid.sub(a.amount);
        await tx.bill.update({
          where: { id: bill.id },
          data: {
            balanceDue: newBalance,
            amountPaid: newPaid,
            status: newPaid.isZero() ? 'open' : 'partially_paid',
          },
        });
      }

      return tx.check.update({
        where: { id: checkId },
        data: {
          status: 'voided',
          voidReason: reason || 'cancelled',
          voidedAt: new Date(),
        },
      });
    });
  }

  async alignmentPdf(companyId: string, bankAccountId: string): Promise<Buffer> {
    const bank = await this.prisma.forCompany(companyId, (tx) =>
      tx.bankAccount.findFirst({
        where: { id: bankAccountId },
        select: { printOffsetX: true, printOffsetY: true },
      }),
    );
    if (!bank) throw new NotFoundException('Bank account not found.');
    return buildAlignmentTestPdf(bank.printOffsetX, bank.printOffsetY);
  }

  setOffsets(
    companyId: string,
    bankAccountId: string,
    offsets: { printOffsetX: number; printOffsetY: number },
  ) {
    return this.prisma.forCompany(companyId, (tx) =>
      tx.bankAccount.update({
        where: { id: bankAccountId },
        data: {
          printOffsetX: offsets.printOffsetX,
          printOffsetY: offsets.printOffsetY,
        },
      }),
    );
  }
}
