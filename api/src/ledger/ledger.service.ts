import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PostingRequest, assertBalanced } from './ledger.types';

/**
 * LedgerService — the single writer of journal entries.
 *
 * `createPostedEntry` runs INSIDE a caller-provided, company-scoped transaction
 * (from PrismaService.forCompany), so RLS is already in effect. It creates the
 * entry as `draft`, inserts the lines, then flips it to `posted` — this order
 * matters because the DB immutability trigger forbids inserting lines onto an
 * already-posted entry, and the balance/post-check trigger validates on the
 * draft->posted transition (see prisma/sql/accounting_core_constraints.sql).
 */
@Injectable()
export class LedgerService {
  /** Create a balanced, posted journal entry within an existing scoped tx. */
  async createPostedEntry(
    tx: PrismaClient,
    req: PostingRequest,
  ): Promise<string> {
    // In-app validation first, for clear errors before hitting DB triggers.
    assertBalanced(req.lines);

    const entry = await tx.journalEntry.create({
      data: {
        companyId: req.companyId,
        entryDate: new Date(req.entryDate),
        memo: req.memo,
        sourceType: req.sourceType as never,
        sourceId: req.sourceId,
        currency: req.currency ?? 'USD',
        createdById: req.createdById,
        status: 'draft',
        lines: {
          create: req.lines.map((l) => ({
            companyId: req.companyId,
            accountId: l.accountId,
            debit: l.debit.toString(),
            credit: l.credit.toString(),
            memo: l.memo,
            entityType: (l.entityType as never) ?? null,
            entityId: l.entityId ?? null,
            dimensions: (l.dimensions ?? {}) as never,
          })),
        },
      },
    });

    // Flip to posted — DB validates balance and stamps posted_at.
    await tx.journalEntry.update({
      where: { id: entry.id },
      data: { status: 'posted' },
    });

    return entry.id;
  }

  /**
   * Reverse a posted entry by creating a mirror-image entry (debits<->credits)
   * dated `reversalDate`, linked via reversalOfId. The original stays intact —
   * corrections are additive, never destructive (docs/DESIGN.md §5.1).
   */
  async reverseEntry(
    tx: PrismaClient,
    companyId: string,
    entryId: string,
    reversalDate: Date | string,
    createdById?: string,
  ): Promise<string> {
    const original = await tx.journalEntry.findUnique({
      where: { id: entryId },
      include: { lines: true },
    });
    if (!original || original.companyId !== companyId) {
      throw new Error('Entry not found in this company.');
    }
    if (original.status !== 'posted') {
      throw new Error('Only posted entries can be reversed.');
    }

    const reversal = await tx.journalEntry.create({
      data: {
        companyId,
        entryDate: new Date(reversalDate),
        memo: `Reversal of ${entryId}`,
        sourceType: original.sourceType,
        sourceId: original.sourceId,
        currency: original.currency,
        createdById,
        status: 'draft',
        reversalOfId: original.id,
        lines: {
          create: original.lines.map((l) => ({
            companyId,
            accountId: l.accountId,
            debit: l.credit, // swap
            credit: l.debit, // swap
            memo: `Reversal: ${l.memo ?? ''}`.trim(),
            entityType: l.entityType,
            entityId: l.entityId,
            dimensions: l.dimensions as never,
          })),
        },
      },
    });

    await tx.journalEntry.update({
      where: { id: reversal.id },
      data: { status: 'posted' },
    });

    return reversal.id;
  }
}
