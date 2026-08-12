import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OnboardingService } from './onboarding.service';
import { CurrentUser, Public } from './decorators';

/**
 * Onboarding / sign-up. Marked @Public so a new org can be created before any
 * session exists.
 *
 * Self-serve org creation is gated in `OnboardingService.assertSelfSignupAllowed`:
 * off unless `ALLOW_SELF_SIGNUP=true`, except for the very first organization so
 * a fresh install can still bootstrap.
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
    return this.onboarding.createCompanyForUser(user.id, body);
  }
}
