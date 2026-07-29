import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AdminPrismaService } from './admin-prisma.service';
import { CoaSeederService } from '../accounts/coa-seeder.service';
import { AuthService } from './auth.service';
import { hashPassword } from './crypto/password';
import { EncryptionService } from '../common/crypto/encryption.service';

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

  async createOrganization(input: OnboardInput) {
    if (!input.owner?.password) {
      throw new BadRequestException('Owner password is required.');
    }

    const result = await this.admin.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { name: input.organizationName },
      });

      const ownerRole = await tx.role.create({
        data: {
          organizationId: org.id,
          name: 'Owner',
          isSystem: true,
          permissions: ['*'],
        },
      });

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

      // Reuse an Owner role in the org, or create one.
      const ownerRole =
        (await tx.role.findFirst({
          where: { organizationId, name: 'Owner' },
        })) ??
        (await tx.role.create({
          data: {
            organizationId,
            name: 'Owner',
            isSystem: true,
            permissions: ['*'],
          },
        }));

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
}
