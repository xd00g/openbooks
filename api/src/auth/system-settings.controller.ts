import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from './decorators';
import { SystemSettingsService } from './system-settings.service';
import { MailService } from './mail.service';
import { EncryptionService } from '../common/crypto/encryption.service';

/**
 * Deployment-level system settings (SSO / SMTP), managed from the Admin UI.
 * Gated by `system:manage` — the Owner role's `*` satisfies it. Secrets are
 * never returned to the client: reads expose only "is a secret set" booleans,
 * and writes that omit a secret preserve the stored one.
 */
@ApiTags('system')
@ApiHeader({ name: 'X-Company-Id', required: true })
@Controller('system/settings')
export class SystemSettingsController {
  constructor(
    private readonly settings: SystemSettingsService,
    private readonly mail: MailService,
    private readonly enc: EncryptionService,
  ) {}

  /** Encrypt a secret before storage. Preserved (already-encrypted) values pass
   *  through unchanged; new plaintext gets encrypted. */
  private secret(value: string): string {
    return this.enc.encrypt(value) ?? '';
  }

  @Get()
  @RequirePermissions('system:manage')
  get() {
    const oidc = this.settings.oidc();
    const saml = this.settings.saml();
    const smtp = this.settings.smtp();
    return {
      oidc: {
        issuerUrl: oidc.issuerUrl,
        clientId: oidc.clientId,
        redirectUri: oidc.redirectUri,
        hasClientSecret: !!oidc.clientSecret,
        configured: !!(oidc.issuerUrl && oidc.clientId),
      },
      saml: {
        entryPoint: saml.entryPoint,
        issuer: saml.issuer,
        callbackUrl: saml.callbackUrl,
        hasCert: !!saml.cert,
        configured: !!(saml.entryPoint && saml.cert),
      },
      smtp: {
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        username: smtp.username,
        fromEmail: smtp.fromEmail,
        fromName: smtp.fromName,
        hasPassword: !!smtp.password,
        configured: !!(smtp.host && smtp.fromEmail),
      },
    };
  }

  @Put('oidc')
  @RequirePermissions('system:manage')
  async putOidc(
    @Body()
    body: {
      issuerUrl?: string;
      clientId?: string;
      clientSecret?: string;
      redirectUri?: string;
    },
  ) {
    const prev = this.settings.snapshot('oidc');
    await this.settings.set('oidc', {
      issuerUrl: body.issuerUrl ?? '',
      clientId: body.clientId ?? '',
      redirectUri: body.redirectUri ?? '',
      // Keep the stored (encrypted) secret when the client leaves it blank.
      clientSecret: this.secret(
        body.clientSecret?.trim()
          ? body.clientSecret.trim()
          : ((prev.clientSecret as string) ?? ''),
      ),
    });
    return this.get().oidc;
  }

  @Put('saml')
  @RequirePermissions('system:manage')
  async putSaml(
    @Body()
    body: {
      entryPoint?: string;
      issuer?: string;
      cert?: string;
      callbackUrl?: string;
    },
  ) {
    const prev = this.settings.snapshot('saml');
    await this.settings.set('saml', {
      entryPoint: body.entryPoint ?? '',
      issuer: body.issuer ?? 'openbooks',
      callbackUrl: body.callbackUrl ?? '',
      cert: this.secret(
        body.cert?.trim() ? body.cert.trim() : ((prev.cert as string) ?? ''),
      ),
    });
    return this.get().saml;
  }

  @Put('smtp')
  @RequirePermissions('system:manage')
  async putSmtp(
    @Body()
    body: {
      host?: string;
      port?: number;
      secure?: boolean;
      username?: string;
      password?: string;
      fromEmail?: string;
      fromName?: string;
    },
  ) {
    const prev = this.settings.snapshot('smtp');
    await this.settings.set('smtp', {
      host: body.host ?? '',
      port: Number(body.port ?? 587),
      secure: !!body.secure,
      username: body.username ?? '',
      fromEmail: body.fromEmail ?? '',
      fromName: body.fromName ?? 'OpenBooks',
      password: this.secret(
        body.password?.trim()
          ? body.password.trim()
          : ((prev.password as string) ?? ''),
      ),
    });
    return this.get().smtp;
  }

  @Post('smtp/test')
  @RequirePermissions('system:manage')
  testSmtp(@Body() body: { to: string }) {
    return this.mail.sendTest(body?.to);
  }
}
