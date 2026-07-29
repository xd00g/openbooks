import { Injectable, UnauthorizedException } from '@nestjs/common';
import { SAML, type SamlConfig } from '@node-saml/node-saml';
import { AuthenticatedProfile } from './provider.interface';
import { mapSamlAssertion } from './saml.mapping';

/**
 * SAML 2.0 (SP-initiated). Signature validation, canonicalization, and replay
 * protection are delegated to @node-saml/node-saml. We only build the redirect
 * and map a validated assertion to our normalized profile.
 *
 * Required env: SAML_ENTRY_POINT (IdP SSO URL), SAML_ISSUER (SP entity id),
 * SAML_CERT (IdP signing cert, PEM), SAML_CALLBACK_URL.
 */
@Injectable()
export class SamlProvider {
  get configured() {
    return !!(process.env.SAML_ENTRY_POINT && process.env.SAML_CERT);
  }

  private client(): SAML {
    const config: SamlConfig = {
      entryPoint: process.env.SAML_ENTRY_POINT,
      issuer: process.env.SAML_ISSUER ?? 'openbooks',
      idpCert: process.env.SAML_CERT ?? '',
      callbackUrl: process.env.SAML_CALLBACK_URL ?? '',
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: true,
    };
    return new SAML(config);
  }

  async buildAuthorizeUrl(): Promise<{ url: string }> {
    if (!this.configured) throw new UnauthorizedException('SAML not configured.');
    const url = await this.client().getAuthorizeUrlAsync('', '', {});
    return { url };
  }

  async validateResponse(samlResponse: string): Promise<AuthenticatedProfile> {
    if (!samlResponse) throw new UnauthorizedException('Missing SAMLResponse.');
    const { profile } = await this.client().validatePostResponseAsync({
      SAMLResponse: samlResponse,
    });
    if (!profile) throw new UnauthorizedException('Invalid SAML assertion.');
    const p = profile as unknown as {
      nameID: string;
      email?: string;
      attributes?: Record<string, string | string[]>;
    };
    return mapSamlAssertion({
      nameID: p.nameID,
      email: p.email,
      attributes: p.attributes ?? (profile as Record<string, string | string[]>),
    });
  }
}
