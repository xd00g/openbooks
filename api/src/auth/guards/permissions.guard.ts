import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminPrismaService } from '../admin-prisma.service';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../decorators';
import { hasAllPermissions, resolveCompanyAccess, MembershipView } from '../authz';

/**
 * Enforces company access + RBAC. Runs after JwtAuthGuard.
 *
 * Rules:
 *  - system admins bypass (break-glass).
 *  - if an X-Company-Id is present, the user MUST have a membership there —
 *    this is the real tenant gate (RLS trusts the GUC, so the app must verify
 *    the user is entitled to that company before any service sets it).
 *  - if @RequirePermissions is declared, the membership's role must satisfy them.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly admin: AdminPrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const required =
      this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
        ctx.getHandler(),
        ctx.getClass(),
      ]) ?? [];

    const req = ctx.switchToHttp().getRequest();
    const user = req.user;
    if (!user) throw new ForbiddenException('Not authenticated.');

    const dbUser = await this.admin.user.findUnique({
      where: { id: user.id },
      select: { isSystemAdmin: true, isActive: true },
    });
    if (!dbUser?.isActive) throw new ForbiddenException('User is inactive.');

    const companyId: string | undefined = req.headers['x-company-id'];

    if (dbUser.isSystemAdmin) {
      req.companyAccess = companyId
        ? { companyId, organizationId: null, permissions: ['*'] }
        : undefined;
      return true;
    }

    if (companyId) {
      const memberships = await this.loadMemberships(user.id);
      const access = resolveCompanyAccess(memberships, companyId);
      if (!access) throw new ForbiddenException('No access to this company.');
      if (required.length && !hasAllPermissions(access.permissions, required)) {
        throw new ForbiddenException('Insufficient permissions.');
      }
      req.companyAccess = access;
      return true;
    }

    // No company context: only allowed if the route needs no permissions.
    if (required.length) {
      throw new ForbiddenException('X-Company-Id header required.');
    }
    return true;
  }

  private async loadMemberships(userId: string): Promise<MembershipView[]> {
    const rows = await this.admin.membership.findMany({
      where: { userId },
      include: { role: { select: { permissions: true } } },
    });
    return rows.map((m) => ({
      companyId: m.companyId,
      organizationId: m.organizationId,
      permissions: m.role.permissions,
    }));
  }
}
