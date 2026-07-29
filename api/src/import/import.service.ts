import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../common/crypto/encryption.service';
import {
  parseIif,
  toAccounts,
  toCustomers,
  toVendors,
} from './iif.logic';

interface CommitOptions {
  accounts?: boolean;
  customers?: boolean;
  vendors?: boolean;
}

@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly enc: EncryptionService,
  ) {}

  /** Parse only — no writes. Powers the preview/confirmation step. */
  previewIif(content: string) {
    const parsed = parseIif(content);
    const { accounts, warnings } = toAccounts(parsed);
    const customers = toCustomers(parsed);
    const vendors = toVendors(parsed);
    return {
      accounts,
      customers,
      vendors,
      counts: {
        accounts: accounts.length,
        customers: customers.length,
        vendors: vendors.length,
      },
      warnings,
    };
  }

  async commitIif(companyId: string, content: string, opts: CommitOptions) {
    const parsed = parseIif(content);
    const result = {
      accounts: { created: 0, skipped: 0 },
      customers: { created: 0, skipped: 0 },
      vendors: { created: 0, skipped: 0 },
      warnings: [] as string[],
    };

    return this.prisma.forCompany(companyId, async (tx) => {
      if (opts.accounts) {
        const { accounts, warnings } = toAccounts(parsed);
        result.warnings.push(...warnings);
        const existing = await tx.account.findMany({
          select: { code: true, name: true },
        });
        const usedCodes = new Set(existing.map((a) => a.code));
        const names = new Set(existing.map((a) => a.name.toLowerCase()));
        // Import range for accounts that arrive without a QuickBooks number.
        let counter = 9000;
        const nextCode = () => {
          while (usedCodes.has(String(counter))) counter++;
          return String(counter);
        };
        for (const a of accounts) {
          if (names.has(a.name.toLowerCase())) {
            result.accounts.skipped++;
            continue;
          }
          const code = a.code && !usedCodes.has(a.code) ? a.code : nextCode();
          usedCodes.add(code);
          try {
            await tx.account.create({
              data: {
                companyId,
                code,
                name: a.name,
                type: a.type as never,
                subtype: a.subtype as never,
                description: a.description ?? null,
                isSystem: false,
                isActive: true,
              },
            });
            names.add(a.name.toLowerCase());
            result.accounts.created++;
          } catch {
            result.accounts.skipped++;
          }
        }
      }

      if (opts.customers) {
        const customers = toCustomers(parsed);
        const existing = await tx.customer.findMany({
          select: { displayName: true },
        });
        const names = new Set(existing.map((c) => c.displayName.toLowerCase()));
        for (const c of customers) {
          if (names.has(c.displayName.toLowerCase())) {
            result.customers.skipped++;
            continue;
          }
          await tx.customer.create({
            data: {
              companyId,
              displayName: c.displayName,
              companyName: c.companyName ?? null,
              email: c.email ?? null,
              phone: c.phone ?? null,
            },
          });
          names.add(c.displayName.toLowerCase());
          result.customers.created++;
        }
      }

      if (opts.vendors) {
        const vendors = toVendors(parsed);
        const existing = await tx.vendor.findMany({
          select: { displayName: true },
        });
        const names = new Set(existing.map((v) => v.displayName.toLowerCase()));
        for (const v of vendors) {
          if (names.has(v.displayName.toLowerCase())) {
            result.vendors.skipped++;
            continue;
          }
          await tx.vendor.create({
            data: {
              companyId,
              displayName: v.displayName,
              companyName: v.companyName ?? null,
              email: v.email ?? null,
              phone: v.phone ?? null,
              taxId: v.taxId ? this.enc.encrypt(v.taxId) : null,
            },
          });
          names.add(v.displayName.toLowerCase());
          result.vendors.created++;
        }
      }

      return result;
    });
  }
}
