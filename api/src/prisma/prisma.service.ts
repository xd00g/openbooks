import { INestApplication, Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma client wrapper.
 *
 * `forCompany()` returns a client bound to a transaction that has set the
 * `app.current_company` GUC, so PostgreSQL Row-Level Security transparently
 * scopes every query to that tenant (see docs/DESIGN.md §4.2 and the SQL in
 * prisma/sql/accounting_core_constraints.sql).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
  }

  async enableShutdownHooks(app: INestApplication) {
    process.on('beforeExit', async () => {
      await app.close();
    });
  }

  /**
   * Run a callback with RLS scoped to `companyId`. All queries inside the
   * callback see only that company's rows.
   */
  async forCompany<T>(
    companyId: string,
    fn: (tx: PrismaClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      // set_config(..., true) => scoped to this transaction only.
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.current_company', $1, true)`,
        companyId,
      );
      return fn(tx as unknown as PrismaClient);
    });
  }
}
