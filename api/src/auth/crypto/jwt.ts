/**
 * Minimal HS256 JWT (Node crypto). Self-contained and dependency-free so the
 * session mechanism is easy to audit and test. If you prefer a maintained
 * library (jsonwebtoken / jose) the call sites (AuthService) are the only place
 * to change.
 */
import { createHmac, timingSafeEqual } from 'crypto';

export interface JwtPayload {
  sub: string; // user id
  email?: string;
  iat?: number;
  exp?: number;
  [k: string]: unknown;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export function signJwt(
  payload: JwtPayload,
  secret: string,
  opts: { expiresInSec?: number } = {},
): string {
  if (!secret) throw new Error('JWT secret is not configured.');
  const now = Math.floor(Date.now() / 1000);
  const body: JwtPayload = {
    ...payload,
    iat: now,
    exp: now + (opts.expiresInSec ?? 3600),
  };
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify(body));
  const data = `${header}.${claims}`;
  const sig = createHmac('sha256', secret).update(data).digest();
  return `${data}.${b64url(sig)}`;
}

export class JwtError extends Error {}

export function verifyJwt(token: string, secret: string): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new JwtError('Malformed token.');
  const [header, claims, sig] = parts;
  const data = `${header}.${claims}`;
  const expected = createHmac('sha256', secret).update(data).digest();
  const given = Buffer.from(sig, 'base64url');
  if (
    expected.length !== given.length ||
    !timingSafeEqual(expected, given)
  ) {
    throw new JwtError('Invalid signature.');
  }
  const payload = JSON.parse(
    Buffer.from(claims, 'base64url').toString('utf8'),
  ) as JwtPayload;
  if (payload.exp && Math.floor(Date.now() / 1000) >= payload.exp) {
    throw new JwtError('Token expired.');
  }
  return payload;
}
