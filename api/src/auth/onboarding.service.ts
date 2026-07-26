import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AdminPrismaService } from './admin-prisma.service';
import { CoaSeederService } from '../accounts/coa-seeder.service';
import { AuthService } from './auth.service';
import { hashPassword } from './crypto/password';

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
}
