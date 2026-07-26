/**
 * Password hashing via scrypt (Node crypto — no external dependency).
 *
 * Stored format:  scrypt$<N>$<saltHex>$<hashHex>
 * scrypt is memory-hard and a sound choice for password storage. For very high
 * throughput you may swap in argon2id; the stored-format prefix lets both
 * coexist during a migration.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const COST = 16384; // scrypt N (CPU/memory cost)
const KEYLEN = 64;

export function hashPassword(password: string): string {
  if (!password || password.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, { N: COST });
  return `scrypt$${COST}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const cost = Number(parts[1]);
  const salt = Buffer.from(parts[2], 'hex');
  const expected = Buffer.from(parts[3], 'hex');
  const actual = scryptSync(password, salt, expected.length, { N: cost });
  // Constant-time comparison to avoid timing leaks.
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
