import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword } from '../auth/crypto/password';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  /** Members of the current company with their user + role. */
  listMembers(companyId: string) {
    return this.prisma.forCompany(companyId, (tx) =>
      tx.membership.findMany({
        where: { companyId },
        include: {
          user: { select: { id: true, email: true, fullName: true, isActive: true, authProvider: true } },
          role: { select: { id: true, name: true, permissions: true } },
        },
      }),
    );
  }

  /** Roles available to this company's organization (plus system templates). */
  listRoles(companyId: string) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const company = await tx.company.findUnique({
        where: { id: companyId },
        select: { organizationId: true },
      });
      return tx.role.findMany({
        where: { OR: [{ organizationId: company!.organizationId }, { organizationId: null }] },
        orderBy: { name: 'asc' },
      });
    });
  }

  createRole(companyId: string, data: { name: string; description?: string; permissions: string[] }) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const company = await tx.company.findUnique({
        where: { id: companyId },
        select: { organizationId: true },
      });
      return tx.role.create({
        data: {
          organizationId: company!.organizationId,
          name: data.name,
          description: data.description,
          permissions: data.permissions ?? [],
        },
      });
    });
  }

  /**
   * Add a member. Links an existing user by email, or creates a local user if a
   * temporary password is supplied. Idempotent on (user, company) — updates the
   * role if the membership already exists.
   */
  addMember(
    companyId: string,
    data: { email: string; roleId: string; fullName?: string; password?: string },
  ) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const company = await tx.company.findUnique({
        where: { id: companyId },
        select: { organizationId: true },
      });

      let user = await tx.user.findUnique({ where: { email: data.email } });
      if (!user) {
        if (!data.password) {
          throw new BadRequestException(
            'User does not exist. Provide a temporary password to create a local user, or have them sign in via SSO first.',
          );
        }
        user = await tx.user.create({
          data: {
            email: data.email,
            fullName: data.fullName,
            passwordHash: hashPassword(data.password),
            authProvider: 'local',
          },
        });
      }

      return tx.membership.upsert({
        where: { userId_companyId: { userId: user.id, companyId } },
        update: { roleId: data.roleId },
        create: {
          userId: user.id,
          companyId,
          organizationId: company!.organizationId,
          roleId: data.roleId,
        },
        include: { user: { select: { email: true } }, role: { select: { name: true } } },
      });
    });
  }

  updateMemberRole(companyId: string, userId: string, roleId: string) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const m = await tx.membership.findUnique({
        where: { userId_companyId: { userId, companyId } },
      });
      if (!m) throw new NotFoundException('Membership not found.');
      return tx.membership.update({
        where: { userId_companyId: { userId, companyId } },
        data: { roleId },
      });
    });
  }

  removeMember(companyId: string, userId: string) {
    return this.prisma.forCompany(companyId, (tx) =>
      tx.membership.delete({ where: { userId_companyId: { userId, companyId } } }),
    );
  }

  listAudit(companyId: string) {
    return this.prisma.forCompany(companyId, (tx) =>
      tx.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
    );
  }
}
