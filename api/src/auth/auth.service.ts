import {
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AdminPrismaService } from './admin-prisma.service';
import { hashPassword, verifyPassword } from './crypto/password';
import { signJwt } from './crypto/jwt';
import { AuthenticatedProfile } from './providers/provider.interface';
import { MembershipView } from './authz';

const SESSION_TTL = 8 * 60 * 60; // 8 hours

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly log = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: AdminPrismaService,
  ) {}

  /** Seed a break-glass local admin on first boot if none exist. */
  async onModuleInit() {
    const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
    if (!email || !password) return;
    const count = await this.admin.user.count();
    if (count > 0) return;
    await this.admin.user.create({
      data: {
        email,
        fullName: 'Bootstrap Admin',
        passwordHash: hashPassword(password),
        authProvider: 'local',
        isSystemAdmin: true,
      },
    });
    this.log.warn(`Created bootstrap admin ${email}. Change this password ASAP.`);
  }

  private secret(): string {
    const s = process.env.JWT_SECRET;
    if (!s) throw new Error('JWT_SECRET is not configured.');
    return s;
  }

  issueSession(user: { id: string; email: string }) {
    const token = signJwt(
      { sub: user.id, email: user.email },
      this.secret(),
      { expiresInSec: SESSION_TTL },
    );
    return { token, expiresInSec: SESSION_TTL };
  }

  /** Local username/password login. */
  async loginLocal(email: string, password: string) {
    const user = await this.admin.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials.');
    }
    if (!verifyPassword(password, user.passwordHash)) {
      throw new UnauthorizedException('Invalid credentials.');
    }
    return { ...this.issueSession(user), user: this.publicUser(user) };
  }

  /**
   * JIT-provision a user from an SSO profile (OIDC/SAML). Matches on the
   * provider subject, then email; links the subject on first login.
   * Group -> role mapping and membership assignment is a follow-up (admins can
   * assign memberships; see OnboardingService).
   */
  async provisionFromProfile(profile: AuthenticatedProfile) {
    const subjectField =
      profile.provider === 'saml' ? 'samlSubject' : 'oidcSubject';

    let user = await this.admin.user.findFirst({
      where: {
        OR: [{ [subjectField]: profile.subject } as never, { email: profile.email }],
      },
    });

    if (!user) {
      user = await this.admin.user.create({
        data: {
          email: profile.email,
          fullName: profile.fullName,
          authProvider: profile.provider,
          [subjectField]: profile.subject,
        } as never,
      });
    } else if (!(user as never as Record<string, unknown>)[subjectField]) {
      user = await this.admin.user.update({
        where: { id: user.id },
        data: { [subjectField]: profile.subject } as never,
      });
    }

    return { ...this.issueSession(user), user: this.publicUser(user) };
  }

  /** The authenticated user's memberships (across companies) for RBAC. */
  async membershipsFor(userId: string): Promise<MembershipView[]> {
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

  async me(userId: string) {
    const user = await this.admin.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    const memberships = await this.admin.membership.findMany({
      where: { userId },
      include: {
        company: { select: { id: true, legalName: true } },
        role: { select: { name: true, permissions: true } },
      },
    });
    return {
      user: this.publicUser(user),
      memberships: memberships.map((m) => ({
        companyId: m.companyId,
        company: m.company.legalName,
        role: m.role.name,
        permissions: m.role.permissions,
      })),
    };
  }

  private publicUser(u: {
    id: string;
    email: string;
    fullName: string | null;
    isSystemAdmin: boolean;
    authProvider: string;
  }) {
    return {
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      isSystemAdmin: u.isSystemAdmin,
      authProvider: u.authProvider,
    };
  }
}
