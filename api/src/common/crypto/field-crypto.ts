/**
 * Authenticated field encryption (AES-256-GCM) for secrets at rest.
 *
 * Pure + dependency-free (Node crypto only) so it can be unit-tested and reused
 * by the backfill script. Ciphertext is self-describing:
 *
 *   enc:v1:<base64 iv>:<base64 tag>:<base64 ciphertext>
 *
 * Values without the `enc:v1:` prefix are treated as legacy plaintext and pass
 * through decrypt() unchanged, so encryption can be rolled out incrementally.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

export const ENC_PREFIX = 'enc:v1:';

/** Parse a 32-byte key from 64 hex chars or base64. Returns null if unset. */
export function loadKey(raw: string | undefined): Buffer | null {
  if (!raw) return null;
  const buf = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error(
      'FIELD_ENCRYPTION_KEY must decode to 32 bytes (AES-256): 64 hex chars, or base64 of 32 bytes.',
    );
  }
  return buf;
}

export function isEncrypted(v: unknown): v is string {
  return typeof v === 'string' && v.startsWith(ENC_PREFIX);
}

export function encryptWith(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

export function decryptWith(key: Buffer, value: string): string {
  // Base64 alphabet never contains ':', so a plain split is unambiguous.
  const parts = value.split(':');
  if (parts.length !== 5 || parts[0] !== 'enc' || parts[1] !== 'v1') {
    throw new Error('Malformed ciphertext.');
  }
  const iv = Buffer.from(parts[2], 'base64');
  const tag = Buffer.from(parts[3], 'base64');
  const ct = Buffer.from(parts[4], 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
