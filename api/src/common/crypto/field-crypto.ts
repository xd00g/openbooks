/**
 * Authenticated field encryption (AES-256-GCM) for secrets at rest.
 *
 * Pure + dependency-free (Node crypto only) so it can be unit-tested and reused
 * by the backfill/rekey scripts. Ciphertext is self-describing:
 *
 *   v1 (legacy):  enc:v1:<base64 iv>:<base64 tag>:<base64 ciphertext>
 *   v2:           enc:v2:<keyId>:<base64 iv>:<base64 tag>:<base64 ciphertext>
 *
 * Values without an `enc:` prefix are treated as legacy plaintext and pass
 * through decrypt() unchanged, so encryption can be rolled out incrementally.
 *
 * ## Why v2 exists
 *
 * v1 records the *format* version but not *which key* encrypted the value. That
 * makes rotation impossible: with two keys in play there is no way to tell which
 * one a given row needs, and a wrong key fails GCM authentication rather than
 * returning garbage. v2 stamps the key id, so a keyring can hold the old and new
 * keys simultaneously — which is what turns rotation into a reversible,
 * zero-downtime operation instead of a decrypt-everything-at-once gamble.
 *
 * v1 values are read as key id `v1` (LEGACY_KEY_ID), so adopting v2 needs no
 * data migration: put the existing key in the keyring under that id and old rows
 * keep decrypting until the rekey job upgrades them.
 *
 * See docs/KEY-MANAGEMENT.md.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

export const ENC_PREFIX = 'enc:v1:';
export const ENC_PREFIX_V2 = 'enc:v2:';

/** Key id assigned to legacy `enc:v1:` values, which carry no id of their own. */
export const LEGACY_KEY_ID = 'v1';

/**
 * Key ids appear in the envelope, which is ':'-delimited, so they must not
 * contain a colon. Keep them short and boring — they end up in every row.
 */
const KEY_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

export interface Keyring {
  /** All keys available for *decryption*, by id. */
  readonly keys: ReadonlyMap<string, Buffer>;
  /** The key new writes are encrypted under. Must be present in `keys`. */
  readonly activeId: string;
}

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
  return typeof v === 'string' && (v.startsWith(ENC_PREFIX) || v.startsWith(ENC_PREFIX_V2));
}

export function assertValidKeyId(id: string): void {
  if (!KEY_ID_RE.test(id)) {
    throw new Error(
      `Invalid key id ${JSON.stringify(id)}: use 1-32 chars of [A-Za-z0-9_-] (no ':', which delimits the envelope).`,
    );
  }
}

/**
 * Parse `"<id>:<key>,<id>:<key>"` into a decryption key set.
 *
 * Split on the FIRST colon only — base64 keys can end in '=' but never contain
 * ':', while a naive split would mangle nothing today and everything the day
 * someone adds a key id with punctuation.
 */
export function parseKeyEntries(spec: string): Map<string, Buffer> {
  const keys = new Map<string, Buffer>();
  for (const part of spec.split(',')) {
    const entry = part.trim();
    if (!entry) continue;
    const sep = entry.indexOf(':');
    if (sep <= 0) {
      throw new Error(`Malformed key entry ${JSON.stringify(entry)}: expected "<keyId>:<key>".`);
    }
    const id = entry.slice(0, sep);
    assertValidKeyId(id);
    if (keys.has(id)) throw new Error(`Duplicate key id ${JSON.stringify(id)} in the keyring.`);
    const key = loadKey(entry.slice(sep + 1));
    if (!key) throw new Error(`Key ${JSON.stringify(id)} has no value.`);
    keys.set(id, key);
  }
  return keys;
}

export function makeKeyring(keys: Map<string, Buffer>, activeId: string): Keyring {
  assertValidKeyId(activeId);
  if (!keys.has(activeId)) {
    const known = [...keys.keys()].join(', ') || '(none)';
    throw new Error(
      `Active key id ${JSON.stringify(activeId)} is not in the keyring. Known ids: ${known}.`,
    );
  }
  return { keys, activeId };
}

/**
 * Which key does this value need? `v1` for legacy values.
 *
 * Lets the rekey job decide what to re-encrypt without attempting decryption,
 * and lets an operator audit which keys are still in use before retiring one.
 */
export function keyIdOf(value: string): string {
  const parts = value.split(':');
  if (parts[0] !== 'enc') throw new Error('Not ciphertext.');
  if (parts[1] === 'v1') {
    if (parts.length !== 5) throw new Error('Malformed ciphertext.');
    return LEGACY_KEY_ID;
  }
  if (parts[1] === 'v2') {
    if (parts.length !== 6) throw new Error('Malformed ciphertext.');
    assertValidKeyId(parts[2]);
    return parts[2];
  }
  throw new Error(`Unsupported ciphertext version ${JSON.stringify(parts[1])}.`);
}

export function encryptWithKeyring(kr: Keyring, plaintext: string): string {
  const key = kr.keys.get(kr.activeId);
  if (!key) throw new Error(`Active key ${JSON.stringify(kr.activeId)} is not in the keyring.`);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX_V2}${kr.activeId}:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

export function decryptWithKeyring(kr: Keyring, value: string): string {
  const id = keyIdOf(value);
  const key = kr.keys.get(id);
  if (!key) {
    // Name the id. "Malformed ciphertext" sends an operator hunting a data bug
    // when the real problem is a key that was retired too early.
    throw new Error(
      `No key with id ${JSON.stringify(id)} in the keyring; cannot decrypt. ` +
        `Known ids: ${[...kr.keys.keys()].join(', ') || '(none)'}.`,
    );
  }
  const parts = value.split(':');
  const off = parts[1] === 'v2' ? 3 : 2;
  const iv = Buffer.from(parts[off], 'base64');
  const tag = Buffer.from(parts[off + 1], 'base64');
  const ct = Buffer.from(parts[off + 2], 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** True when the value is ciphertext under a key other than the active one. */
export function needsRekey(kr: Keyring, value: string): boolean {
  return isEncrypted(value) && keyIdOf(value) !== kr.activeId;
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
