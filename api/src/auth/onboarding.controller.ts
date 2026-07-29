import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OnboardingService } from './onboarding.service';
import { CurrentUser, Public } from './decorators';

/**
 * Onboarding / sign-up. Marked @Public so a new org can be created before any
 * session exists. In production gate this behind an invite code or restrict to
 * system admins — self-serve org creation is a policy decision (design §17).
 */
@ApiTags('onboarding')
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Public()
  @Post()
  create(
    @Body()
    body: {
      organizationName: string;
      company: { legalName: string; baseCurrency?: string; country?: string };
      owner: { email: string; fullName?: string; password: string };
    },
  ) {
    return this.onboarding.createOrganization(body);
  }

  /**
   * Create an additional company for the authenticated user (or bootstrap their
   * first org+company if they have none — e.g. a fresh SSO sign-in). Requires a
   * session; the caller becomes Owner of the new company.
   */
  @Post('company')
  createCompany(
    @CurrentUser() user: { id: string },
    @Body()
    body: {
      legalName: string;
      baseCurrency?: string;
      country?: string;
      organizationName?: string;
    },
  ) {
    return this.onboarding.createCompanyForUser(user.id, body);
  }
}
