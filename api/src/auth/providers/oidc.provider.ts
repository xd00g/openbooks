import { Injectable, Logger } from '@nestjs/common';
import { codeChallengeS256, generateCodeVerifier, generateState } from '../crypto/pkce';
import { AuthenticatedProfile } from './provider.interface';

/**
 * OIDC (Authorization Code + PKCE) provider. Works with Authentik, Keycloak,
 * Entra ID, Google, Auth0, etc. via discovery.
 *
 * This uses the OIDC discovery document + token endpoint directly (fetch) to
 * avoid a heavy dependency; for production hardening consider `openid-client`
 * (nonce, JWKS signature verification of the id_token). The id_token claims are
 * read here after the code exchange; JWKS verification is a documented TODO.
 */
@Injectable()
export class OidcProvider {
  private readonly log = new Logger(OidcProvider.name);
  private discovery?: { authorization_endpoint: string; token_endpoint: string; userinfo_endpoint?: string };

  private get issuer() {
    return process.env.OIDC_ISSUER_URL ?? '';
  }
  get configured() {
    return !!(this.issuer && process.env.OIDC_CLIENT_ID);
  }

  private async discover() {
    if (this.discovery) return this.discovery;
    const url = `${this.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
    this.discovery = await res.json();
    return this.discovery!;
  }

  /** Build the authorize URL and the PKCE/state to persist in the session. */
  async buildAuthorizeUrl(): Promise<{ url: string; state: string; codeVerifier: string }> {
    const d = await this.discover();
    const codeVerifier = generateCodeVerifier();
    const state = generateState();
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: process.env.OIDC_CLIENT_ID ?? '',
      redirect_uri: process.env.OIDC_REDIRECT_URI ?? '',
      scope: 'openid email profile groups',
      state,
      code_challenge: codeChallengeS256(codeVerifier),
      code_challenge_method: 'S256',
    });
    return { url: `${d.authorization_endpoint}?${params}`, state, codeVerifier };
  }

  /** Exchange the code for tokens and return a normalized profile. */
  async handleCallback(code: string, codeVerifier: string): Promise<AuthenticatedProfile> {
    const d = await this.discover();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.OIDC_REDIRECT_URI ?? '',
      client_id: process.env.OIDC_CLIENT_ID ?? '',
      client_secret: process.env.OIDC_CLIENT_SECRET ?? '',
      code_verifier: codeVerifier,
    });
    const res = await fetch(d.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new Error(`OIDC token exchange failed: ${res.status}`);
    const tokens = (await res.json()) as { id_token: string; access_token: string };

    const claims = this.decodeIdToken(tokens.id_token);
    return {
      provider: 'oidc',
      subject: String(claims.sub),
      email: String(claims.email ?? ''),
      fullName: claims.name ? String(claims.name) : undefined,
      groups: Array.isArray(claims.groups) ? (claims.groups as string[]) : [],
    };
  }

  /**
   * Decode id_token claims. TODO: verify the signature against the issuer JWKS
   * before trusting these claims in production.
   */
  private decodeIdToken(idToken: string): Record<string, unknown> {
    const parts = idToken.split('.');
    if (parts.length !== 3) throw new Error('Malformed id_token.');
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  }
}
