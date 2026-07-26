import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * A PrismaClient connected with an RLS-bypassing role (a superuser or a role
 * with BYPASSRLS), used ONLY for:
 *   - reading a user's memberships during auth (before a company is selected)
 *   - onboarding: creating the first Organization/Company rows, which cannot
 *     satisfy the company table's own RLS INSERT check (docs/DESIGN.md §17)
 *
 * Everything else must use the normal, RLS-enforced PrismaService. Keep the set
 * of queries that run here tiny and auditable.
 *
 * Configure ADMIN_DATABASE_URL to the privileged role; falls back to
 * DATABASE_URL for dev convenience.
 */
@Injectable()
export class AdminPrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    super({
      datasources: {
        db: {
          url: process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL,
        },
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }
}
