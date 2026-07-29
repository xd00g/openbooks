import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AdminPrismaService } from '../auth/admin-prisma.service';
import { hashPassword } from '../auth/crypto/password';

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
  constructor(private readonly admin: AdminPrismaService) {}

  private async orgId(companyId: string): Promise<string> {
    const c = await this.admin.company.findUnique({
      where: { id: companyId },
      select: { organizationId: true },
    });
    if (!c) throw new NotFoundException('Company not found.');
    return c.organizationId;
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

  async updateUser(_currentCompanyId: string, userId: string, data: { fullName?: string; isActive?: boolean }) {
    const patch: Record<string, unknown> = {};
    if (data.fullName !== undefined) patch.fullName = data.fullName;
    if (data.isActive !== undefined) patch.isActive = data.isActive;
    return this.admin.user.update({
      where: { id: userId }, data: patch,
      select: { id: true, email: true, fullName: true, isActive: true },
    });
  }

  async resetPassword(_currentCompanyId: string, userId: string, newPassword: string) {
    if (!newPassword || newPassword.length < 8) throw new BadRequestException('Password must be at least 8 characters.');
    await this.admin.user.update({ where: { id: userId }, data: { passwordHash: hashPassword(newPassword) } });
    return { reset: true };
  }

  /** Grant (or update the role of) a user's access to a company in this org. */
  async assignMembership(currentCompanyId: string, userId: string, targetCompanyId: string, roleId: string) {
    const orgId = await this.orgId(currentCompanyId);
    const target = await this.admin.company.findFirst({ where: { id: targetCompanyId, organizationId: orgId }, select: { id: true } });
    if (!target) throw new BadRequestException('That company is not in this organization.');
    const role = await this.admin.role.findFirst({ where: { id: roleId } });
    if (!role) throw new BadRequestException('Role not found.');
    return this.admin.membership.upsert({
      where: { userId_companyId: { userId, companyId: targetCompanyId } },
      update: { roleId },
      create: { userId, companyId: targetCompanyId, organizationId: orgId, roleId },
      select: { id: true },
    });
  }

  async removeMembership(_currentCompanyId: string, userId: string, targetCompanyId: string) {
    await this.admin.membership
      .delete({ where: { userId_companyId: { userId, companyId: targetCompanyId } } })
      .catch(() => undefined);
    return { removed: true };
  }
}
