import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  actorUserId?: string | null;
  action: string;
  tableName: string;
  recordId?: string | null;
  before?: unknown;
  after?: unknown;
  requestId?: string | null;
}

/**
 * Writes an append-only audit trail (docs/DESIGN.md §5.5). Company-scoped, so
 * rows land under the right tenant and RLS keeps them isolated. Audit writes
 * must never break the request that triggered them — callers swallow errors.
 */
@Injectable()
export class AuditService {
  private readonly log = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(companyId: string, entry: AuditEntry): Promise<void> {
    await this.prisma.forCompany(companyId, (tx) =>
      tx.auditLog.create({
        data: {
          companyId,
          actorUserId: entry.actorUserId ?? null,
          action: entry.action,
          tableName: entry.tableName,
          recordId: entry.recordId ?? null,
          before: (entry.before ?? undefined) as never,
          after: (entry.after ?? undefined) as never,
          requestId: entry.requestId ?? null,
        },
      }),
    );
  }
}
