import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { AdminPrismaService } from './admin-prisma.service';
import { CoaSeederService } from '../accounts/coa-seeder.service';
import { AuthService } from './auth.service';
import { hashPassword } from './crypto/password';
import { EncryptionService } from '../common/crypto/encryption.service';
import { SYSTEM_ROLES } from './permissions.catalog';

interface OnboardInput {
  organizationName: string;
  company: { legalName: string; baseCurrency?: string; country?: string };
  owner: { email: string; fullName?: string; password: string };
}

/**
 * Privileged onboarding. Creating the first Organization/Company rows can't
 * satisfy the company table's RLS INSERT check (current_company_id() is null),
 * so this runs on the RLS-bypassing admin connection. It then seeds the chart
 * of accounts via the normal (RLS) path, which works because the company now
 * exists. This is the resolution to the design's company-creation open item.
 */
@Injectable()
export class OnboardingService {
  private readonly log = new Logger(OnboardingService.name);

  constructor(
    private readonly admin: AdminPrismaService,
    private readonly coaSeeder: CoaSeederService,
    private readonly auth: AuthService,
    private readonly enc: EncryptionService,
  ) {}

  /**
   * Self-serve org creation is off by default.
   *
   * This endpoint is @Public, and it mints an Owner holding `['*']`. On an
   * internet-reachable deployment that is the entry point an attacker needs
   * before they can start probing the org-admin surface, so it must be opted
   * into rather than out of.
   *
   * The first org is always allowed: with no organizations yet there is nobody
   * to attack and nobody who could flip the flag, so gating it unconditionally
   * would leave a fresh install with no way to bootstrap.
   */
  private async assertSelfSignupAllowed(): Promise<void> {
    if (process.env.ALLOW_SELF_SIGNUP === 'true') return;
    const existing = await this.admin.organization.count();
    if (existing === 0) return;
    throw new ForbiddenException(
      'Self-serve sign-up is disabled. Ask an administrator for an invitation.',
    );
  }

  async createOrganization(input: OnboardInput) {
    await this.assertSelfSignupAllowed();

    if (!input.owner?.password) {
      throw new BadRequestException('Owner password is required.');
    }

    const result = await this.admin.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { name: input.organizationName },
      });

      const ownerRole = await this.ensureSystemRoles(tx, org.id);

      const owner = await tx.user.upsert({
        where: { email: input.owner.email },
        update: {},
        create: {
          email: input.owner.email,
          fullName: input.owner.fullName,
          passwordHash: hashPassword(input.owner.password),
          authProvider: 'local',
        },
      });

      const company = await tx.company.create({
        data: {
          organizationId: org.id,
          legalName: input.company.legalName,
          baseCurrency: input.company.baseCurrency ?? 'USD',
          country: input.company.country ?? 'US',
        },
      });

      await tx.membership.create({
        data: {
          userId: owner.id,
          companyId: company.id,
          organizationId: org.id,
          roleId: ownerRole.id,
        },
      });

      return { org, company, owner };
    });

    // Seed the chart of accounts through the normal RLS path.
    await this.coaSeeder.seed(result.company.id);

    this.log.log(
      `Onboarded org ${result.org.id}, company ${result.company.id}, owner ${result.owner.email}`,
    );

    const session = this.auth.issueSession(result.owner);
    return {
      organizationId: result.org.id,
      companyId: result.company.id,
      ownerId: result.owner.id,
      ...session,
    };
  }

  /**
   * Create an additional company for an already-authenticated user. If the user
   * already belongs to an organization we create the company under it (reusing
   * or creating an "Owner" role); otherwise — e.g. a first-time SSO user with no
   * memberships — we bootstrap a fresh organization for them. Runs on the
   * RLS-bypassing admin connection for the same reason as createOrganization:
   * a brand-new company can't satisfy the company table's RLS INSERT check.
   */
  async createCompanyForUser(
    userId: string,
    input: {
      legalName: string;
      baseCurrency?: string;
      country?: string;
      organizationName?: string;
      dba?: string;
      ein?: string;
      email?: string;
      phone?: string;
      addressLine1?: string;
      addressLine2?: string;
      city?: string;
      region?: string;
      postalCode?: string;
      fiscalYearStartMonth?: number;
    },
  ) {
    const legalName = input?.legalName?.trim();
    if (!legalName) {
      throw new BadRequestException('Company legal name is required.');
    }

    const result = await this.admin.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new BadRequestException('User not found.');

      const existing = await tx.membership.findFirst({
        where: { userId },
        select: { organizationId: true },
      });

      let organizationId = existing?.organizationId;
      if (!organizationId) {
        const org = await tx.organization.create({
          data: { name: input.organizationName?.trim() || legalName },
        });
        organizationId = org.id;
      }

      // Reuse an Owner role in the org, or create one (along with the other
      // starter roles, if missing).
      const ownerRole = await this.ensureSystemRoles(tx, organizationId);

      const company = await tx.company.create({
        data: {
          organizationId,
          legalName,
          baseCurrency: input.baseCurrency?.trim() || 'USD',
          country: input.country?.trim() || 'US',
          dba: input.dba?.trim() || null,
          ein: input.ein?.trim() ? this.enc.encrypt(input.ein.trim()) : null,
          email: input.email?.trim() || null,
          phone: input.phone?.trim() || null,
          addressLine1: input.addressLine1?.trim() || null,
          addressLine2: input.addressLine2?.trim() || null,
          city: input.city?.trim() || null,
          region: input.region?.trim() || null,
          postalCode: input.postalCode?.trim() || null,
          fiscalYearStartMonth: input.fiscalYearStartMonth ?? 1,
        },
      });

      await tx.membership.create({
        data: {
          userId,
          companyId: company.id,
          organizationId,
          roleId: ownerRole.id,
        },
      });

      return { company };
    });

    // Seed the chart of accounts through the normal RLS path.
    await this.coaSeeder.seed(result.company.id);

    this.log.log(
      `User ${userId} created company ${result.company.id} (${result.company.legalName})`,
    );

    return {
      companyId: result.company.id,
      legalName: result.company.legalName,
    };
  }

  /**
   * Ensure the four starter roles exist for an organization and return Owner.
   * Idempotent: matched on (organizationId, name), which is already a unique
   * constraint, so an operator who customised a role keeps their version.
   */
  private async ensureSystemRoles(tx: any, organizationId: string) {
    let owner: any = null;
    for (const def of SYSTEM_ROLES) {
      const existing = await tx.role.findFirst({
        where: { organizationId, name: def.name },
      });
      const row =
        existing ??
        (await tx.role.create({
          data: {
            organizationId,
            name: def.name,
            description: def.description,
            permissions: def.permissions,
            isSystem: true,
          },
        }));
      if (def.name === 'Owner') owner = row;
    }
    return owner;
  }
}
