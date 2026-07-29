import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { EncryptionService } from '../common/crypto/encryption.service';

const EDITABLE = [
  'legalName',
  'dba',
  'ein',
  'email',
  'phone',
  'addressLine1',
  'addressLine2',
  'city',
  'region',
  'postalCode',
  'country',
  'baseCurrency',
  'fiscalYearStartMonth',
  'logoStorageKey',
] as const;

@Injectable()
export class CompanyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attachments: AttachmentsService,
    private readonly enc: EncryptionService,
  ) {}

  async get(companyId: string) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const c = await tx.company.findUnique({ where: { id: companyId } });
      if (!c) throw new NotFoundException('Company not found.');
      // EIN is stored encrypted at rest; expose the plaintext to callers.
      if (c.ein) c.ein = this.enc.decrypt(c.ein);
      return c;
    });
  }

  async update(companyId: string, body: Record<string, unknown>) {
    const data: Record<string, unknown> = {};
    for (const k of EDITABLE) if (k in body) data[k] = body[k];
    // Encrypt the tax id before it hits the database.
    if (typeof data.ein === 'string') data.ein = this.enc.encrypt(data.ein);

    const wantsJsonMerge =
      (body.settings && typeof body.settings === 'object') ||
      (body.theme && typeof body.theme === 'object');

    return this.prisma.forCompany(companyId, async (tx) => {
      // settings and theme are JSON blobs — shallow-merge so partial updates
      // don't clobber unrelated keys.
      if (wantsJsonMerge) {
        const cur = await tx.company.findUnique({
          where: { id: companyId },
          select: { settings: true, theme: true },
        });
        for (const field of ['settings', 'theme'] as const) {
          if (body[field] && typeof body[field] === 'object') {
            data[field] = {
              ...((cur?.[field] as Prisma.JsonObject) ?? {}),
              ...(body[field] as Prisma.JsonObject),
            } as Prisma.InputJsonValue;
          }
        }
      }
      return tx.company.update({ where: { id: companyId }, data });
    });
  }

  /** Presigned URL for the company logo, or null if none is set. */
  async logoUrl(companyId: string) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const c = await tx.company.findUnique({
        where: { id: companyId },
        select: { logoStorageKey: true },
      });
      if (!c?.logoStorageKey) return { url: null };
      return this.attachments.presignGet(companyId, c.logoStorageKey);
    });
  }
}
