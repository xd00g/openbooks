import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccountsModule } from '../accounts/accounts.module';
import { AdminPrismaService } from './admin-prisma.service';
import { AuthService } from './auth.service';
import { OnboardingService } from './onboarding.service';
import { SystemSettingsService } from './system-settings.service';
import { MailService } from './mail.service';
import { OidcProvider } from './providers/oidc.provider';
import { SamlProvider } from './providers/saml.provider';
import { AuthController } from './auth.controller';
import { OnboardingController } from './onboarding.controller';
import { SystemSettingsController } from './system-settings.controller';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';

/**
 * AuthModule wires pluggable providers (local / OIDC / SAML), issues app
 * sessions, and installs the two global guards. Order matters: JwtAuthGuard
 * runs first (authenticate), then PermissionsGuard (authorize).
 */
@Module({
  imports: [AccountsModule],
  controllers: [AuthController, OnboardingController, SystemSettingsController],
  providers: [
    AdminPrismaService,
    AuthService,
    OnboardingService,
    SystemSettingsService,
    MailService,
    OidcProvider,
    SamlProvider,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [AuthService, AdminPrismaService, SystemSettingsService, MailService],
})
export class AuthModule {}
