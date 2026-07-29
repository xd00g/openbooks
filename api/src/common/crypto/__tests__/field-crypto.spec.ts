import { randomBytes } from 'crypto';
import {
  decryptWith,
  encryptWith,
  isEncrypted,
  loadKey,
  ENC_PREFIX,
} from '../field-crypto';

describe('field-crypto', () => {
  const key = randomBytes(32);

  it('round-trips a value', () => {
    const secret = 'https://user:pass@bridge.simplefin.org/access';
    const ct = encryptWith(key, secret);
    expect(ct.startsWith(ENC_PREFIX)).toBe(true);
    expect(ct).not.toContain(secret);
    expect(decryptWith(key, ct)).toBe(secret);
  });

  it('produces a fresh IV each time (ciphertexts differ)', () => {
    expect(encryptWith(key, 'same')).not.toEqual(encryptWith(key, 'same'));
  });

  it('detects tampering via the auth tag', () => {
    const ct = encryptWith(key, 'sensitive');
    const parts = ct.split(':');
    const body = Buffer.from(parts[4], 'base64');
    body[0] ^= 0x01; // flip a bit of the ciphertext
    parts[4] = body.toString('base64');
    expect(() => decryptWith(key, parts.join(':'))).toThrow();
  });

  it('fails with the wrong key', () => {
    const ct = encryptWith(key, 'sensitive');
    expect(() => decryptWith(randomBytes(32), ct)).toThrow();
  });

  it('recognises encrypted vs plaintext', () => {
    expect(isEncrypted(encryptWith(key, 'x'))).toBe(true);
    expect(isEncrypted('plain-text-value')).toBe(false);
    expect(isEncrypted(null)).toBe(false);
  });

  it('parses hex and base64 keys, rejects wrong lengths', () => {
    expect(loadKey(undefined)).toBeNull();
    expect(loadKey('a'.repeat(64))?.length).toBe(32); // hex
    expect(loadKey(randomBytes(32).toString('base64'))?.length).toBe(32);
    expect(() => loadKey('tooshort')).toThrow();
  });
});
