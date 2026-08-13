import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AdminPrismaService } from '../auth/admin-prisma.service';
import { hashPassword } from '../auth/crypto/password';
import { assertWouldNotOrphanCompany } from './admin.service';
import { grantsUserManage } from '../auth/authz';

/** Postgres 23503. Prisma surfaces it as P2003, raw SQL as the pg code. */
function isForeignKeyViolation(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  const msg = (e as { message?: string })?.message ?? '';
  return code === '23503' || code === 'P2003' || /foreign key constraint/i.test(msg);
}

/**
 * Cross-company (organization-level) administration: manage all users and all
 * company files in the org, regardless of the currently-selected company.
 *
 * Runs on the RLS-bypassing admin connection because it spans tenants. Guarded
 * at the controller by `user:manage`; the org is derived from the caller's
 * active company (X-Company-Id).
 */
@Injectable()
export class AdminOrgService {
  private readonly log = new Logger(AdminOrgService.name);

  constructor(private readonly admin: AdminPrismaService) {}

  private async orgId(companyId: string): Promise<string> {
    const c = await this.admin.company.findUnique({
      where: { id: companyId },
      select: { organizationId: true },
    });
    if (!c) throw new NotFoundException('Company not found.');
    return c.organizationId;
  }

  /**
   * Prove the target user is inside the caller's organization, and return it.
   *
   * Every mutation here runs on the RLS-bypassing admin connection, and
   * `PermissionsGuard` only ever checked `user:manage` against the caller's own
   * X-Company-Id — it knows nothing about the `userId` in the path. So without
   * this, an Owner of any org could reset the password of, deactivate, or
   * unmember *any user in the deployment*.
   *
   * Deliberately NotFound rather than Forbidden: a distinguishable response
   * would turn these endpoints into an oracle for which user ids exist.
   */
  private async assertUserInOrg(currentCompanyId: string, userId: string): Promise<string> {
    const orgId = await this.orgId(currentCompanyId);
    const member = await this.admin.membership.findFirst({
      where: { userId, organizationId: orgId },
      select: { id: true },
    });
    if (!member) throw new NotFoundException('User not found in this organization.');
    return orgId;
  }

  /** Same, for a company referenced by id in the path/body. */
  private async assertCompanyInOrg(orgId: string, targetCompanyId: string): Promise<void> {
    const target = await this.admin.company.findFirst({
      where: { id: targetCompanyId, organizationId: orgId },
      select: { id: true },
    });
    if (!target) throw new NotFoundException('Company not found in this organization.');
  }

  /** Every user with access somewhere in the org, plus their company memberships. */
  async listUsers(currentCompanyId: string) {
    const orgId = await this.orgId(currentCompanyId);
    const memberships = await this.admin.membership.findMany({
      where: { organizationId: orgId },
      include: {
        user: { select: { id: true, email: true, fullName: true, isActive: true, authProvider: true } },
        company: { select: { id: true, legalName: true } },
        role: { select: { id: true, name: true } },
      },
    });
    const byUser = new Map<string, any>();
    for (const m of memberships) {
      if (!byUser.has(m.user.id)) byUser.set(m.user.id, { ...m.user, memberships: [] });
      byUser.get(m.user.id).memberships.push({
        companyId: m.company.id, company: m.company.legalName, roleId: m.role.id, role: m.role.name,
      });
    }
    return [...byUser.values()].sort((a, b) => (a.email > b.email ? 1 : -1));
  }

  /** All company files in the org with who has access. */
  async listCompanies(currentCompanyId: string) {
    const orgId = await this.orgId(currentCompanyId);
    const companies = await this.admin.company.findMany({
      where: { organizationId: orgId },
      select: {
        id: true, legalName: true, baseCurrency: true, createdAt: true,
        memberships: {
          select: { userId: true, user: { select: { email: true, fullName: true } }, role: { select: { name: true } } },
        },
      },
      orderBy: { legalName: 'asc' },
    });
    return companies.map((c) => ({
      id: c.id, legalName: c.legalName, baseCurrency: c.baseCurrency, createdAt: c.createdAt,
      members: c.memberships.map((m) => ({ userId: m.userId, email: m.user.email, fullName: m.user.fullName, role: m.role.name })),
    }));
  }

  async listRoles(currentCompanyId: string) {
    const orgId = await this.orgId(currentCompanyId);
    return this.admin.role.findMany({
      where: { OR: [{ organizationId: orgId }, { organizationId: null }] },
      select: { id: true, name: true, permissions: true },
      orderBy: { name: 'asc' },
    });
  }

  async createUser(_currentCompanyId: string, data: { email: string; fullName?: string; password: string }) {
    if (!data.email?.trim()) throw new BadRequestException('Email is required.');
    if (!data.password || data.password.length < 8) throw new BadRequestException('Password must be at least 8 characters.');
    const existing = await this.admin.user.findUnique({ where: { email: data.email.trim() } });
    if (existing) throw new BadRequestException('A user with that email already exists.');
    return this.admin.user.create({
      data: { email: data.email.trim(), fullName: data.fullName, passwordHash: hashPassword(data.password), authProvider: 'local' },
      select: { id: true, email: true, fullName: true, isActive: true },
    });
  }

  async updateUser(
    currentCompanyId: string,
    userId: string,
    data: { fullName?: string; isActive?: boolean },
    actingUserId?: string,
  ) {
    await this.assertUserInOrg(currentCompanyId, userId);

    if (data.isActive === false) {
      if (actingUserId && actingUserId === userId) {
        throw new ConflictException('You cannot deactivate your own account.');
      }

      // Deactivation is indistinguishable from removal once
      // PermissionsGuard rejects every request from an inactive user — so it
      // must pass the same lockout check as removing a membership, for every
      // company this user belongs to.
      const memberships = await this.admin.membership.findMany({
        where: { userId },
        select: { companyId: true },
      });
      for (const { companyId } of memberships) {
        await assertWouldNotOrphanCompany(
          this.admin,
          companyId,
          { userId, newPermissions: null },
          'This would deactivate the last member who can manage users for one of this user\'s companies.',
        );
      }
    }

    const patch: Record<string, unknown> = {};
    if (data.fullName !== undefined) patch.fullName = data.fullName;
    if (data.isActive !== undefined) patch.isActive = data.isActive;
    return this.admin.user.update({
      where: { id: userId }, data: patch,
      select: { id: true, email: true, fullName: true, isActive: true },
    });
  }

  async resetPassword(currentCompanyId: string, userId: string, newPassword: string) {
    await this.assertUserInOrg(currentCompanyId, userId);
    if (!newPassword || newPassword.length < 8) throw new BadRequestException('Password must be at least 8 characters.');
    await this.admin.user.update({ where: { id: userId }, data: { passwordHash: hashPassword(newPassword) } });
    return { reset: true };
  }

  /** Grant (or update the role of) a user's access to a company in this org. */
  async assignMembership(currentCompanyId: string, userId: string, targetCompanyId: string, roleId: string) {
    const orgId = await this.orgId(currentCompanyId);
    const target = await this.admin.company.findFirst({ where: { id: targetCompanyId, organizationId: orgId }, select: { id: true } });
    if (!target) throw new BadRequestException('That company is not in this organization.');
    // Scope the role to this org (or the built-in null-org roles) — `role` has
    // no RLS, so an unfiltered lookup lets a caller adopt another
    // organization's role definition and whatever permissions it carries.
    const role = await this.admin.role.findFirst({
      where: { id: roleId, OR: [{ organizationId: orgId }, { organizationId: null }] },
    });
    if (!role) throw new BadRequestException('Role not found.');

    // Only an update to an *existing* membership can orphan the company — a
    // brand-new membership only ever adds someone. Only check when the new
    // role would drop user:manage; a promotion can never orphan.
    const existing = await this.admin.membership.findUnique({
      where: { userId_companyId: { userId, companyId: targetCompanyId } },
      select: { id: true },
    });
    if (existing && !grantsUserManage(role.permissions as string[])) {
      await assertWouldNotOrphanCompany(
        this.admin,
        targetCompanyId,
        { userId, newPermissions: role.permissions as string[] },
        'This change would leave the company with no one who can manage users.',
      );
    }

    return this.admin.membership.upsert({
      where: { userId_companyId: { userId, companyId: targetCompanyId } },
      update: { roleId },
      create: { userId, companyId: targetCompanyId, organizationId: orgId, roleId },
      select: { id: true },
    });
  }

  /**
   * Permanently delete a company and every row belonging to it.
   *
   * There is no undo. The only recovery is a database restore, so the caller
   * must retype the company's legal name and the deployment must have a working
   * backup (docs/RESTORE.md).
   *
   * Three things make this more than a `DELETE`:
   *
   * 1. **The ledger is immutable by trigger.** `trg_journal_entry_immutable` and
   *    `trg_journal_line_immutable` both fire BEFORE DELETE, and the deferred
   *    balance trigger fires on DELETE too, so a posted entry cannot be removed
   *    by ordinary means. Purging a whole tenant is the one legitimate reason to
   *    lift them, and only inside this transaction — a rollback restores them.
   * 2. **Table order is not knowable up front.** Rather than hardcode a
   *    dependency order that rots the moment a model is added, retry each
   *    tenant table until nothing more can be deleted. FK enforcement stays ON,
   *    so a genuine violation aborts the whole transaction instead of leaving a
   *    dangling row.
   * 3. **Tenant tables are discovered from the catalog**, not from a list. A
   *    hand-maintained list is the same trap as `tenant_tables` in
   *    accounting_core_constraints.sql, where a missing entry shipped a data
   *    leak — here it would silently orphan a table's rows instead.
   *
   * Object storage is purged by the caller (the controller) after this commits,
   * because it cannot participate in the transaction. Deleting rows first is the
   * correct order: an orphaned object is recoverable, a row pointing at a
   * deleted object is not.
   */
  async purgeCompany(
    currentCompanyId: string,
    targetCompanyId: string,
    confirmLegalName: string,
    actingUserId?: string,
  ): Promise<{ companyId: string; legalName: string; rowsDeleted: number }> {
    const orgId = await this.orgId(currentCompanyId);

    const target = await this.admin.company.findFirst({
      where: { id: targetCompanyId, organizationId: orgId },
      select: { id: true, legalName: true },
    });
    if (!target) throw new NotFoundException('Company not found in this organization.');

    // Retyping the name is the guard against deleting the wrong company from a
    // list of similar ones. Compare trimmed but case-sensitively: this should
    // feel deliberate.
    if (confirmLegalName?.trim() !== target.legalName) {
      throw new BadRequestException(
        `To confirm deletion, provide the company's exact legal name: "${target.legalName}".`,
      );
    }

    // Never leave the organization with nothing. Deleting the last company
    // would strand its users with no company to select and no way back in.
    const remaining = await this.admin.company.count({ where: { organizationId: orgId } });
    if (remaining <= 1) {
      throw new ConflictException(
        'This is the last company in the organization and cannot be deleted.',
      );
    }

    // The audit row must be written OUTSIDE the purge: audit_log is itself a
    // tenant table, so a record written against the deleted company would be
    // deleted along with it. Attribute it to the acting user's current company,
    // which survives.
    this.log.warn(
      `Purging company ${target.legalName} (${target.id}) from org ${orgId}` +
        (actingUserId ? `, requested by user ${actingUserId}` : ''),
    );

    const rowsDeleted = await this.admin.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'ALTER TABLE journal_entry DISABLE TRIGGER trg_journal_entry_immutable',
      );
      await tx.$executeRawUnsafe(
        'ALTER TABLE journal_line DISABLE TRIGGER trg_journal_line_immutable',
      );
      await tx.$executeRawUnsafe(
        'ALTER TABLE journal_line DISABLE TRIGGER trg_journal_line_balanced',
      );

      const tables = await tx.$queryRawUnsafe<{ relname: string }[]>(
        `SELECT c.relname FROM pg_class c
           JOIN pg_namespace ns ON ns.oid = c.relnamespace
           JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'companyId' AND a.attnum > 0
          WHERE ns.nspname = 'public' AND c.relkind = 'r'
          ORDER BY c.relname`,
      );

      let total = 0;
      let progress = true;
      let rounds = 0;
      while (progress && rounds < 25) {
        progress = false;
        rounds++;
        for (const { relname } of tables) {
          try {
            const n = await tx.$executeRawUnsafe(
              `DELETE FROM "${relname}" WHERE "companyId" = $1::uuid`,
              targetCompanyId,
            );
            if (n > 0) {
              total += n;
              progress = true;
            }
          } catch (e) {
            // Dependents still present — a later round will reach it. Any other
            // error, and the transaction is already poisoned, so rethrow.
            if (!isForeignKeyViolation(e)) throw e;
          }
        }
      }

      const companyRows = await tx.$executeRawUnsafe(
        'DELETE FROM company WHERE id = $1::uuid',
        targetCompanyId,
      );
      if (companyRows !== 1) {
        throw new Error(
          `Expected to delete exactly 1 company row, deleted ${companyRows}. Rolled back.`,
        );
      }

      await tx.$executeRawUnsafe(
        'ALTER TABLE journal_entry ENABLE TRIGGER trg_journal_entry_immutable',
      );
      await tx.$executeRawUnsafe(
        'ALTER TABLE journal_line ENABLE TRIGGER trg_journal_line_immutable',
      );
      await tx.$executeRawUnsafe(
        'ALTER TABLE journal_line ENABLE TRIGGER trg_journal_line_balanced',
      );

      return total;
    });

    this.log.warn(`Purged company ${target.id}: ${rowsDeleted} row(s) deleted.`);
    return { companyId: target.id, legalName: target.legalName, rowsDeleted };
  }

  async removeMembership(currentCompanyId: string, userId: string, targetCompanyId: string) {
    const orgId = await this.assertUserInOrg(currentCompanyId, userId);
    await this.assertCompanyInOrg(orgId, targetCompanyId);

    await assertWouldNotOrphanCompany(
      this.admin,
      targetCompanyId,
      { userId, newPermissions: null },
      'This would remove the last member who can manage users.',
    );

    await this.admin.membership
      .delete({ where: { userId_companyId: { userId, companyId: targetCompanyId } } })
      .catch(() => undefined);
    return { removed: true };
  }
}
