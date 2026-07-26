import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OnboardingService } from './onboarding.service';
import { Public } from './decorators';

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
}
