import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AdminPrismaService } from './admin-prisma.service';
import { EncryptionService } from '../common/crypto/encryption.service';

export interface OidcConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}
export interface SamlConfig {
  entryPoint: string;
  issuer: string;
  cert: string;
  callbackUrl: string;
}
export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromEmail: string;
  fromName: string;
}

/**
 * Deployment-level settings (SSO / SMTP) with a DB-over-env merge.
 *
 * Values are cached in memory so the auth providers can read them synchronously
 * (they were env getters before). The cache loads at boot and updates on every
 * write. CRUCIALLY, each field falls back to its historic environment variable,
 * so a deployment with no rows in system_setting behaves EXACTLY as it did when
 * config was env-only — this is what makes DB-backing safe for live auth.
 *
 * Runs on the RLS-bypassing admin connection: system_setting is cross-tenant
 * and must resolve on the pre-company login path.
 */
@Injectable()
export class SystemSettingsService implements OnModuleInit {
  private readonly log = new Logger(SystemSettingsService.name);
  private cache: Record<string, Record<string, unknown>> = {};

  constructor(
    private readonly admin: AdminPrismaService,
    private readonly enc: EncryptionService,
  ) {}

  async onModuleInit() {
    try {
      await this.reload();
    } catch (e) {
      // A missing table (pre-migration) must not crash boot — fall back to env.
      this.log.warn(`system_setting unavailable, using env config: ${(e as Error).message}`);
    }
  }

  async reload() {
    const rows = await this.admin.systemSetting.findMany();
    this.cache = Object.fromEntries(
      rows.map((r) => [r.key, (r.value as Record<string, unknown>) ?? {}]),
    );
  }

  private raw(key: string): Record<string, unknown> {
    return this.cache[key] ?? {};
  }

  /** The stored (DB-only, not env-merged) values for a key — used server-side
   *  to preserve secrets that the client didn't resubmit. */
  snapshot(key: string): Record<string, unknown> {
    return { ...this.raw(key) };
  }

  async set(key: string, value: Record<string, unknown>) {
    await this.admin.systemSetting.upsert({
      where: { key },
      create: { key, value: value as never },
      update: { value: value as never },
    });
    this.cache[key] = value;
  }

  private str(v: unknown, fallback = ''): string {
    return typeof v === 'string' && v.length ? v : fallback;
  }

  oidc(): OidcConfig {
    const c = this.raw('oidc');
    return {
      issuerUrl: this.str(c.issuerUrl, process.env.OIDC_ISSUER_URL ?? ''),
      clientId: this.str(c.clientId, process.env.OIDC_CLIENT_ID ?? ''),
      clientSecret:
        this.enc.decrypt(
          this.str(c.clientSecret, process.env.OIDC_CLIENT_SECRET ?? ''),
        ) ?? '',
      redirectUri: this.str(c.redirectUri, process.env.OIDC_REDIRECT_URI ?? ''),
    };
  }

  saml(): SamlConfig {
    const c = this.raw('saml');
    return {
      entryPoint: this.str(c.entryPoint, process.env.SAML_ENTRY_POINT ?? ''),
      issuer: this.str(c.issuer, process.env.SAML_ISSUER ?? 'openbooks'),
      cert:
        this.enc.decrypt(this.str(c.cert, process.env.SAML_CERT ?? '')) ?? '',
      callbackUrl: this.str(c.callbackUrl, process.env.SAML_CALLBACK_URL ?? ''),
    };
  }

  smtp(): SmtpConfig {
    const c = this.raw('smtp');
    const port = Number(c.port ?? process.env.SMTP_PORT ?? 587);
    return {
      host: this.str(c.host, process.env.SMTP_HOST ?? ''),
      port: Number.isFinite(port) ? port : 587,
      secure:
        typeof c.secure === 'boolean'
          ? c.secure
          : (process.env.SMTP_SECURE ?? 'false') === 'true',
      username: this.str(c.username, process.env.SMTP_USER ?? ''),
      password:
        this.enc.decrypt(this.str(c.password, process.env.SMTP_PASSWORD ?? '')) ??
        '',
      fromEmail: this.str(c.fromEmail, process.env.SMTP_FROM_EMAIL ?? ''),
      fromName: this.str(c.fromName, process.env.SMTP_FROM_NAME ?? 'OpenBooks'),
    };
  }
}
