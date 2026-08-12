import { Injectable, Logger } from '@nestjs/common';
import {
  decryptWithKeyring,
  encryptWithKeyring,
  isEncrypted,
  keyIdOf,
  LEGACY_KEY_ID,
  loadKey,
  makeKeyring,
  needsRekey,
  parseKeyEntries,
  type Keyring,
} from './field-crypto';

/**
 * Injectable wrapper over field-crypto. Builds the keyring once at construction.
 *
 * ## Configuration
 *
 *   FIELD_ENCRYPTION_KEYS="2026a:<base64>,2026b:<base64>"   # decryptable keys
 *   FIELD_ENCRYPTION_ACTIVE_KEY_ID=2026b                    # what new writes use
 *
 * A lone `FIELD_ENCRYPTION_KEY` (the pre-rotation config) is still honoured and
 * is adopted as key id `v1` — the same id legacy `enc:v1:` ciphertext resolves
 * to. Existing deployments therefore need no config change and gain rotation for
 * free. If both are set, the single key is added as `v1` unless the keyring
 * already defines that id, so old rows stay readable during a rotation.
 *
 * ## Fail-fast
 *
 * With no key configured this service previously fell back to storing secrets in
 * PLAINTEXT after logging a warning. That is a silent, unrecoverable data
 * problem: one misconfigured restart and SSNs, bank tokens and EINs are written
 * in the clear — and `listEmployees` serves those columns to anyone holding
 * `payroll:view`, which the default Read-only role has. It now refuses to start
 * unless plaintext is explicitly opted into with ALLOW_PLAINTEXT_SECRETS=true.
 *
 * See docs/KEY-MANAGEMENT.md.
 */
@Injectable()
export class EncryptionService {
  private readonly log = new Logger(EncryptionService.name);
  private readonly keyring: Keyring | null;

  constructor() {
    this.keyring = EncryptionService.buildKeyring();

    if (!this.keyring) {
      this.log.warn(
        'ALLOW_PLAINTEXT_SECRETS=true and no encryption key is configured — ' +
          'secret fields (SSN, bank details, EIN, tokens) are stored in PLAINTEXT. ' +
          'Never do this outside local development.',
      );
    } else {
      this.log.log(
        `Field encryption active. Writing under key "${this.keyring.activeId}"; ` +
          `${this.keyring.keys.size} key(s) available for decryption.`,
      );
    }
  }

  /** Returns null only when plaintext passthrough has been explicitly allowed. */
  private static buildKeyring(): Keyring | null {
    const spec = process.env.FIELD_ENCRYPTION_KEYS?.trim();
    const single = process.env.FIELD_ENCRYPTION_KEY?.trim();

    const keys = spec ? parseKeyEntries(spec) : new Map<string, Buffer>();

    // Fold a legacy single key in under the id that legacy ciphertext resolves
    // to, so v1 rows remain readable alongside a v2 keyring.
    if (single && !keys.has(LEGACY_KEY_ID)) {
      const key = loadKey(single);
      if (key) keys.set(LEGACY_KEY_ID, key);
    }

    if (keys.size === 0) {
      if (process.env.ALLOW_PLAINTEXT_SECRETS === 'true') return null;
      throw new Error(
        'No field-encryption key configured. Set FIELD_ENCRYPTION_KEYS ' +
          '("<keyId>:<key>,…" plus FIELD_ENCRYPTION_ACTIVE_KEY_ID) or the legacy ' +
          'FIELD_ENCRYPTION_KEY. Generate one with: openssl rand -base64 32. ' +
          'To run without encryption in local development only, set ' +
          'ALLOW_PLAINTEXT_SECRETS=true.',
      );
    }

    const explicitActive = process.env.FIELD_ENCRYPTION_ACTIVE_KEY_ID?.trim();
    if (explicitActive) return makeKeyring(keys, explicitActive);

    // Unambiguous when there is exactly one key. With several, refuse to guess:
    // picking the wrong one silently writes under a key you meant to retire.
    if (keys.size === 1) return makeKeyring(keys, [...keys.keys()][0]);
    throw new Error(
      `FIELD_ENCRYPTION_ACTIVE_KEY_ID must be set when the keyring holds more than one key. ` +
        `Known ids: ${[...keys.keys()].join(', ')}.`,
    );
  }

  get enabled(): boolean {
    return !!this.keyring;
  }

  /** The key id new writes are stamped with, or null in passthrough mode. */
  get activeKeyId(): string | null {
    return this.keyring?.activeId ?? null;
  }

  /** Encrypt a value. No-ops on null/empty; re-encrypts nothing already current. */
  encrypt(plaintext: string | null | undefined): string | null {
    if (plaintext == null || plaintext === '') return plaintext ?? null;
    if (isEncrypted(plaintext)) return plaintext;
    if (!this.keyring) return plaintext;
    return encryptWithKeyring(this.keyring, plaintext);
  }

  /** Decrypt a value. Legacy plaintext (no prefix) passes through unchanged. */
  decrypt(value: string | null | undefined): string | null {
    if (value == null || value === '') return value ?? null;
    if (!isEncrypted(value)) return value;
    if (!this.keyring) {
      throw new Error(
        'An encryption key is required to read encrypted secrets, but none is configured.',
      );
    }
    return decryptWithKeyring(this.keyring, value);
  }

  /**
   * Re-encrypt a value under the active key. Returns null when nothing is
   * needed, so a rekey job can skip the write. Used by scripts/rekey-encryption.ts.
   */
  rekey(value: string | null | undefined): string | null {
    if (value == null || value === '' || !this.keyring) return null;
    if (!isEncrypted(value)) return encryptWithKeyring(this.keyring, value);
    if (!needsRekey(this.keyring, value)) return null;
    return encryptWithKeyring(this.keyring, decryptWithKeyring(this.keyring, value));
  }

  /** Which key a stored value needs, for auditing before retiring a key. */
  keyIdOfValue(value: string): string | null {
    return isEncrypted(value) ? keyIdOf(value) : null;
  }
}
