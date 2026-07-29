import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Every account subtype maps to exactly one top-level type. Deriving the type
 *  from the subtype keeps the two columns from ever drifting out of sync. */
const SUBTYPE_TO_TYPE: Record<string, string> = {
  bank: 'asset',
  accounts_receivable: 'asset',
  undeposited_funds: 'asset',
  inventory: 'asset',
  fixed_asset: 'asset',
  other_current_asset: 'asset',
  other_asset: 'asset',
  accounts_payable: 'liability',
  credit_card: 'liability',
  sales_tax_payable: 'liability',
  payroll_liability: 'liability',
  other_current_liability: 'liability',
  long_term_liability: 'liability',
  retained_earnings: 'equity',
  opening_balance_equity: 'equity',
  owners_equity: 'equity',
  income: 'income',
  other_income: 'income',
  cost_of_goods_sold: 'expense',
  expense: 'expense',
  other_expense: 'expense',
};

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  list(companyId: string) {
    return this.prisma.forCompany(companyId, (tx) =>
      tx.account.findMany({ orderBy: { code: 'asc' } }),
    );
  }

  /** Account register: posted ledger activity for one account with a running
   *  balance (debit − credit), oldest first. Powers the banking "Accounts" view. */
  register(companyId: string, accountId: string) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const account = await tx.account.findFirst({ where: { id: accountId } });
      if (!account) throw new NotFoundException('Account not found.');
      const lines = await tx.journalLine.findMany({
        where: { accountId, entry: { status: 'posted' } },
        include: { entry: { select: { entryDate: true, memo: true, sourceType: true } } },
        orderBy: [{ entry: { entryDate: 'asc' } }, { createdAt: 'asc' }],
      });
      let running = 0;
      const rows = lines.map((l) => {
        running += Number(l.debit) - Number(l.credit);
        return {
          id: l.id,
          journalEntryId: l.journalEntryId,
          date: l.entry.entryDate,
          memo: l.memo ?? l.entry.memo ?? '',
          source: l.entry.sourceType,
          debit: l.debit.toString(),
          credit: l.credit.toString(),
          balance: running.toFixed(2),
        };
      });
      return {
        account: { id: account.id, code: account.code, name: account.name, type: account.type, subtype: account.subtype },
        balance: running.toFixed(2),
        rows,
      };
    });
  }

  create(
    companyId: string,
    data: {
      code: string;
      name: string;
      subtype: string;
      type?: string;
      parentId?: string;
      description?: string;
    },
  ) {
    const code = data.code?.trim();
    const name = data.name?.trim();
    if (!code || !name) {
      throw new BadRequestException('Account code and name are required.');
    }
    const type = this.typeForSubtype(data.subtype);

    return this.prisma.forCompany(companyId, async (tx) => {
      if (data.parentId) await this.assertParent(tx, companyId, data.parentId);
      try {
        return await tx.account.create({
          data: {
            companyId,
            code,
            name,
            type: type as never,
            subtype: data.subtype as never,
            parentId: data.parentId ?? null,
            description: data.description?.trim() || null,
          },
        });
      } catch (e) {
        throw this.friendly(e, code);
      }
    });
  }

  update(
    companyId: string,
    id: string,
    data: {
      code?: string;
      name?: string;
      subtype?: string;
      parentId?: string | null;
      description?: string;
      isActive?: boolean;
    },
  ) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const acct = await tx.account.findUnique({ where: { id } });
      if (!acct) throw new NotFoundException('Account not found.');

      const patch: Prisma.AccountUncheckedUpdateInput = {};

      if (data.name !== undefined) {
        const name = data.name.trim();
        if (!name) throw new BadRequestException('Account name cannot be empty.');
        patch.name = name;
      }
      if (data.description !== undefined) {
        patch.description = data.description.trim() || null;
      }
      if (data.code !== undefined && data.code.trim() !== acct.code) {
        if (acct.isSystem) {
          throw new BadRequestException('A system account code cannot be changed.');
        }
        const code = data.code.trim();
        if (!code) throw new BadRequestException('Account code cannot be empty.');
        patch.code = code;
      }
      if (data.subtype !== undefined && data.subtype !== acct.subtype) {
        if (acct.isSystem) {
          throw new BadRequestException('A system account type cannot be changed.');
        }
        patch.subtype = data.subtype as never;
        patch.type = this.typeForSubtype(data.subtype) as never;
      }
      if (data.parentId !== undefined) {
        const parentId = data.parentId || null;
        if (parentId) {
          if (parentId === id) {
            throw new BadRequestException('An account cannot be its own parent.');
          }
          await this.assertParent(tx, companyId, parentId);
          await this.assertNoCycle(tx, id, parentId);
        }
        patch.parentId = parentId;
      }
      if (data.isActive !== undefined) {
        if (acct.isSystem && data.isActive === false) {
          throw new BadRequestException('System accounts cannot be deactivated.');
        }
        patch.isActive = data.isActive;
      }

      try {
        return await tx.account.update({ where: { id }, data: patch });
      } catch (e) {
        throw this.friendly(e, String(patch.code ?? acct.code));
      }
    });
  }

  /** Hard-delete an unused, non-system account. In-use accounts must be
   *  deactivated instead so history stays intact. */
  remove(companyId: string, id: string) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const acct = await tx.account.findUnique({
        where: { id },
        include: {
          _count: {
            select: {
              journalLines: true,
              invoiceLines: true,
              billLines: true,
              children: true,
            },
          },
          bankAccount: { select: { id: true } },
        },
      });
      if (!acct) throw new NotFoundException('Account not found.');
      if (acct.isSystem) {
        throw new BadRequestException(
          'System accounts cannot be deleted. Deactivate it instead.',
        );
      }
      const c = acct._count;
      if (
        c.journalLines > 0 ||
        c.invoiceLines > 0 ||
        c.billLines > 0 ||
        c.children > 0 ||
        acct.bankAccount
      ) {
        throw new BadRequestException(
          'This account is in use and cannot be deleted. Deactivate it instead.',
        );
      }
      await tx.account.delete({ where: { id } });
      return { deleted: true };
    });
  }

  private typeForSubtype(subtype: string): string {
    const type = SUBTYPE_TO_TYPE[subtype];
    if (!type) {
      throw new BadRequestException(`Unknown account subtype "${subtype}".`);
    }
    return type;
  }

  private async assertParent(
    tx: PrismaClient,
    companyId: string,
    parentId: string,
  ): Promise<void> {
    const parent = await tx.account.findUnique({
      where: { id: parentId },
      select: { id: true, companyId: true },
    });
    if (!parent || parent.companyId !== companyId) {
      throw new BadRequestException('Parent account not found.');
    }
  }

  /** Walk the proposed parent chain to the root; if we meet `id` it's a cycle. */
  private async assertNoCycle(
    tx: PrismaClient,
    id: string,
    parentId: string,
  ): Promise<void> {
    let cursor: string | null = parentId;
    const seen = new Set<string>();
    while (cursor) {
      if (cursor === id) {
        throw new BadRequestException(
          'That parent would create a circular account hierarchy.',
        );
      }
      if (seen.has(cursor)) break; // pre-existing cycle guard
      seen.add(cursor);
      const row: { parentId: string | null } | null =
        await tx.account.findUnique({
          where: { id: cursor },
          select: { parentId: true },
        });
      cursor = row?.parentId ?? null;
    }
  }

  private friendly(e: unknown, code: string): Error {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return new BadRequestException(`Account code "${code}" is already in use.`);
    }
    return e as Error;
  }
}
