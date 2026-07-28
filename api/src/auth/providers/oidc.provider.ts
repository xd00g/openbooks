import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import {
  codeChallengeS256,
  generateCodeVerifier,
  generateNonce,
  generateState,
} from '../crypto/pkce';
import { AuthenticatedProfile } from './provider.interface';

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
}

/**
 * OIDC (Authorization Code + PKCE) provider with full id_token verification:
 * the token signature is checked against the issuer's JWKS, and issuer,
 * audience, expiry, and nonce are all validated before any claim is trusted.
 * Works with Authentik, Keycloak, Entra ID, Google, Auth0, etc.
 */
@Injectable()
export class OidcProvider {
  private readonly log = new Logger(OidcProvider.name);
  private discovery?: Discovery;
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  private get issuer() {
    return process.env.OIDC_ISSUER_URL ?? '';
  }
  get configured() {
    return !!(this.issuer && process.env.OIDC_CLIENT_ID);
  }

  private async discover(): Promise<Discovery> {
    if (this.discovery) return this.discovery;
    const url = `${this.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
    this.discovery = (await res.json()) as Discovery;
    return this.discovery;
  }

  private async getJwks() {
    const d = await this.discover();
    if (!this.jwks) this.jwks = createRemoteJWKSet(new URL(d.jwks_uri));
    return this.jwks;
  }

  /** Build the authorize URL and the PKCE/state/nonce to persist. */
  async buildAuthorizeUrl(): Promise<{
    url: string;
    state: string;
    codeVerifier: string;
    nonce: string;
  }> {
    const d = await this.discover();
    const codeVerifier = generateCodeVerifier();
    const state = generateState();
    const nonce = generateNonce();
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: process.env.OIDC_CLIENT_ID ?? '',
      redirect_uri: process.env.OIDC_REDIRECT_URI ?? '',
      scope: 'openid email profile groups',
      state,
      nonce,
      code_challenge: codeChallengeS256(codeVerifier),
      code_challenge_method: 'S256',
    });
    return { url: `${d.authorization_endpoint}?${params}`, state, codeVerifier, nonce };
  }

  /** Exchange the code, verify the id_token, and return a normalized profile. */
  async handleCallback(
    code: string,
    codeVerifier: string,
    nonce: string,
  ): Promise<AuthenticatedProfile> {
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
    const tokens = (await res.json()) as { id_token: string };

    // Verify signature (JWKS) + issuer + audience + expiry.
    let payload: JWTPayload;
    try {
      const jwks = await this.getJwks();
      ({ payload } = await jwtVerify(tokens.id_token, jwks, {
        issuer: d.issuer,
        audience: process.env.OIDC_CLIENT_ID,
      }));
    } catch (e) {
      this.log.warn(`id_token verification failed: ${(e as Error).message}`);
      throw new UnauthorizedException('Invalid id_token.');
    }

    if (!payload.nonce || payload.nonce !== nonce) {
      throw new UnauthorizedException('OIDC nonce mismatch.');
    }

    return {
      provider: 'oidc',
      subject: String(payload.sub),
      email: String((payload as Record<string, unknown>).email ?? ''),
      fullName: (payload as Record<string, unknown>).name
        ? String((payload as Record<string, unknown>).name)
        : undefined,
      groups: Array.isArray((payload as Record<string, unknown>).groups)
        ? ((payload as Record<string, unknown>).groups as string[])
        : [],
    };
  }
}
