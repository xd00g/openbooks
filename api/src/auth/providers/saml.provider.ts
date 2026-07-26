import { Injectable } from '@nestjs/common';
import { AuthenticatedProfile } from './provider.interface';

/**
 * SAML 2.0 (SP-initiated) provider — scaffold.
 *
 * Full SAML (signature validation, canonicalization, replay protection) should
 * be delegated to a vetted library such as `@node-saml/node-saml`. This class
 * defines the integration surface and the assertion -> profile mapping; wire the
 * library into `buildAuthorizeUrl` and `validateResponse` when enabling SAML.
 *
 * Required env: SAML_ENTRY_POINT (IdP SSO URL), SAML_ISSUER (SP entity id),
 * SAML_CERT (IdP signing cert), SAML_CALLBACK_URL.
 */
@Injectable()
export class SamlProvider {
  get configured() {
    return !!(process.env.SAML_ENTRY_POINT && process.env.SAML_CERT);
  }

  async buildAuthorizeUrl(): Promise<{ url: string }> {
    // TODO: use node-saml SAML.getAuthorizeUrlAsync(...)
    throw new Error(
      'SAML is not fully wired yet. Integrate @node-saml/node-saml in SamlProvider.',
    );
  }

  /**
   * Validate a SAMLResponse and map the assertion to a normalized profile.
   * `mapAssertion` below is the pure part you can unit test once the library
   * returns a parsed profile.
   */
  async validateResponse(_samlResponse: string): Promise<AuthenticatedProfile> {
    throw new Error(
      'SAML is not fully wired yet. Integrate @node-saml/node-saml in SamlProvider.',
    );
  }

  /** Pure mapping from a parsed SAML profile to our normalized profile. */
  static mapAssertion(profile: {
    nameID: string;
    email?: string;
    attributes?: Record<string, string | string[]>;
  }): AuthenticatedProfile {
    const attrs = profile.attributes ?? {};
    const groupsRaw = attrs['groups'] ?? attrs['memberOf'];
    const groups = Array.isArray(groupsRaw)
      ? groupsRaw
      : groupsRaw
        ? [groupsRaw]
        : [];
    return {
      provider: 'saml',
      subject: profile.nameID,
      email: String(profile.email ?? attrs['email'] ?? ''),
      fullName: (attrs['displayName'] as string) || undefined,
      groups,
    };
  }
}
