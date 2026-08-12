import { randomBytes } from 'crypto';
import {
  decryptWithKeyring,
  encryptWith,
  encryptWithKeyring,
  isEncrypted,
  keyIdOf,
  LEGACY_KEY_ID,
  makeKeyring,
  needsRekey,
  parseKeyEntries,
} from '../field-crypto';
import { EncryptionService } from '../encryption.service';

const KEY_A = randomBytes(32);
const KEY_B = randomBytes(32);
const b64 = (b: Buffer) => b.toString('base64');

const ringOf = (entries: [string, Buffer][], active: string) =>
  makeKeyring(new Map(entries), active);

describe('keyring parsing', () => {
  it('parses id:key pairs', () => {
    const keys = parseKeyEntries(`a:${b64(KEY_A)}, b:${b64(KEY_B)}`);
    expect([...keys.keys()]).toEqual(['a', 'b']);
    expect(keys.get('a')!.equals(KEY_A)).toBe(true);
  });

  it('splits on the first colon only, so base64 padding survives', () => {
    // A base64 key can end in '=' and is itself colon-free, but the id/key
    // separator must not be confused with anything inside the key.
    const keys = parseKeyEntries(`k1:${b64(KEY_A)}`);
    expect(keys.get('k1')!.equals(KEY_A)).toBe(true);
  });

  it('rejects a duplicate key id rather than silently keeping one', () => {
    expect(() => parseKeyEntries(`a:${b64(KEY_A)},a:${b64(KEY_B)}`)).toThrow(/Duplicate key id/);
  });

  it('rejects a key id containing a colon, which would corrupt the envelope', () => {
    expect(() => parseKeyEntries(`a:b:${b64(KEY_A)}`)).toThrow();
  });

  it('refuses an active id that is not in the keyring', () => {
    expect(() => ringOf([['a', KEY_A]], 'nope')).toThrow(/not in the keyring/);
  });
});

describe('v2 envelope', () => {
  const ring = ringOf([['a', KEY_A]], 'a');

  it('round-trips and stamps the active key id', () => {
    const ct = encryptWithKeyring(ring, 'hunter2');
    expect(ct.startsWith('enc:v2:a:')).toBe(true);
    expect(keyIdOf(ct)).toBe('a');
    expect(decryptWithKeyring(ring, ct)).toBe('hunter2');
  });

  it('is recognised as ciphertext', () => {
    expect(isEncrypted(encryptWithKeyring(ring, 'x'))).toBe(true);
  });

  it('uses a fresh IV per call, so identical plaintext differs', () => {
    expect(encryptWithKeyring(ring, 'same')).not.toEqual(encryptWithKeyring(ring, 'same'));
  });

  it('fails closed under the wrong key rather than returning garbage', () => {
    const ct = encryptWithKeyring(ring, 'secret');
    const wrong = ringOf([['a', KEY_B]], 'a'); // same id, different material
    expect(() => decryptWithKeyring(wrong, ct)).toThrow();
  });

  it('names the missing key id when it has been retired too early', () => {
    const ct = encryptWithKeyring(ringOf([['old', KEY_A]], 'old'), 'secret');
    const ring2 = ringOf([['new', KEY_B]], 'new');
    expect(() => decryptWithKeyring(ring2, ct)).toThrow(/"old"/);
  });
});

describe('legacy v1 interop', () => {
  it('reads a v1 value as key id v1, with no data migration', () => {
    const legacy = encryptWith(KEY_A, 'old-secret');
    expect(legacy.startsWith('enc:v1:')).toBe(true);
    expect(keyIdOf(legacy)).toBe(LEGACY_KEY_ID);

    const ring = ringOf([[LEGACY_KEY_ID, KEY_A]], LEGACY_KEY_ID);
    expect(decryptWithKeyring(ring, legacy)).toBe('old-secret');
  });

  it('reads v1 alongside a v2 active key', () => {
    const legacy = encryptWith(KEY_A, 'old-secret');
    const ring = ringOf([[LEGACY_KEY_ID, KEY_A], ['b', KEY_B]], 'b');

    expect(decryptWithKeyring(ring, legacy)).toBe('old-secret');
    expect(decryptWithKeyring(ring, encryptWithKeyring(ring, 'new'))).toBe('new');
  });
});

describe('needsRekey', () => {
  const ring = ringOf([['a', KEY_A], ['b', KEY_B]], 'b');

  it('is true for a value under a non-active key', () => {
    expect(needsRekey(ring, encryptWithKeyring(ringOf([['a', KEY_A]], 'a'), 'x'))).toBe(true);
  });

  it('is true for legacy v1', () => {
    expect(needsRekey(ring, encryptWith(KEY_A, 'x'))).toBe(true);
  });

  it('is false once re-encrypted under the active key', () => {
    expect(needsRekey(ring, encryptWithKeyring(ring, 'x'))).toBe(false);
  });
});

/**
 * The property that makes rotation safe: both keys readable at once, so the
 * flip and the rekey pass are separate, individually reversible steps.
 */
describe('rotation, end to end', () => {
  const ORIGINAL = 'ssn-123-45-6789';

  it('rotates without data loss and is idempotent', () => {
    // 1. Encrypted under the old key.
    const before = encryptWithKeyring(ringOf([['a', KEY_A]], 'a'), ORIGINAL);

    // 2-4. Add the new key and flip active. Old data still reads.
    const during = ringOf([['a', KEY_A], ['b', KEY_B]], 'b');
    expect(decryptWithKeyring(during, before)).toBe(ORIGINAL);

    // 5. Rekey pass.
    const after = encryptWithKeyring(during, decryptWithKeyring(during, before));
    expect(keyIdOf(after)).toBe('b');
    expect(decryptWithKeyring(during, after)).toBe(ORIGINAL);

    // Re-running the job changes nothing.
    expect(needsRekey(during, after)).toBe(false);

    // 6. The old key can now be retired.
    expect(decryptWithKeyring(ringOf([['b', KEY_B]], 'b'), after)).toBe(ORIGINAL);
  });

  it('retiring the old key BEFORE the rekey pass loses the data', () => {
    // Pins the failure mode documented in KEY-MANAGEMENT.md: a backup taken
    // before rotation still needs the old key, so it must stay in escrow.
    const before = encryptWithKeyring(ringOf([['a', KEY_A]], 'a'), ORIGINAL);
    expect(() => decryptWithKeyring(ringOf([['b', KEY_B]], 'b'), before)).toThrow(/"a"/);
  });
});

describe('EncryptionService configuration', () => {
  const ENV = process.env;
  beforeEach(() => {
    process.env = { ...ENV };
    delete process.env.FIELD_ENCRYPTION_KEY;
    delete process.env.FIELD_ENCRYPTION_KEYS;
    delete process.env.FIELD_ENCRYPTION_ACTIVE_KEY_ID;
    delete process.env.ALLOW_PLAINTEXT_SECRETS;
  });
  afterAll(() => {
    process.env = ENV;
  });

  it('REFUSES TO START with no key configured', () => {
    // The whole point of the fail-fast: silently storing SSNs in plaintext is
    // worse than not booting.
    expect(() => new EncryptionService()).toThrow(/No field-encryption key configured/);
  });

  it('allows plaintext only when explicitly opted into', () => {
    process.env.ALLOW_PLAINTEXT_SECRETS = 'true';
    const svc = new EncryptionService();
    expect(svc.enabled).toBe(false);
    expect(svc.encrypt('secret')).toBe('secret');
  });

  it('adopts a lone legacy FIELD_ENCRYPTION_KEY as id v1', () => {
    process.env.FIELD_ENCRYPTION_KEY = b64(KEY_A);
    const svc = new EncryptionService();
    expect(svc.activeKeyId).toBe(LEGACY_KEY_ID);
    // and can still read ciphertext written by the pre-rotation code
    expect(svc.decrypt(encryptWith(KEY_A, 'old'))).toBe('old');
  });

  it('keeps the legacy key readable alongside a new active key', () => {
    process.env.FIELD_ENCRYPTION_KEY = b64(KEY_A);
    process.env.FIELD_ENCRYPTION_KEYS = `b:${b64(KEY_B)}`;
    process.env.FIELD_ENCRYPTION_ACTIVE_KEY_ID = 'b';

    const svc = new EncryptionService();
    expect(svc.activeKeyId).toBe('b');
    expect(svc.decrypt(encryptWith(KEY_A, 'old'))).toBe('old');
    expect(svc.keyIdOfValue(svc.encrypt('new')!)).toBe('b');
  });

  it('refuses to guess the active key when several are configured', () => {
    process.env.FIELD_ENCRYPTION_KEYS = `a:${b64(KEY_A)},b:${b64(KEY_B)}`;
    expect(() => new EncryptionService()).toThrow(/ACTIVE_KEY_ID must be set/);
  });

  it('rekey() upgrades a legacy value and no-ops on a current one', () => {
    process.env.FIELD_ENCRYPTION_KEYS = `${LEGACY_KEY_ID}:${b64(KEY_A)},b:${b64(KEY_B)}`;
    process.env.FIELD_ENCRYPTION_ACTIVE_KEY_ID = 'b';
    const svc = new EncryptionService();

    const upgraded = svc.rekey(encryptWith(KEY_A, 'old'));
    expect(upgraded).not.toBeNull();
    expect(svc.keyIdOfValue(upgraded!)).toBe('b');
    expect(svc.decrypt(upgraded)).toBe('old');

    expect(svc.rekey(upgraded)).toBeNull();
  });
});
