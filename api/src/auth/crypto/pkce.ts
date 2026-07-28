/**
 * PKCE + state helpers for the OIDC Authorization Code flow (RFC 7636).
 * `codeChallengeS256` is deterministic and unit-tested against the RFC vector.
 */
import { createHash, randomBytes } from 'crypto';

export function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

export function codeChallengeS256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function generateState(): string {
  return randomBytes(16).toString('base64url');
}

/** Opaque nonce bound to the id_token to prevent replay (OIDC core). */
export function generateNonce(): string {
  return randomBytes(16).toString('base64url');
}
