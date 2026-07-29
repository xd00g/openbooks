import { Injectable, Logger } from '@nestjs/common';
import {
  decryptWith,
  encryptWith,
  isEncrypted,
  loadKey,
} from './field-crypto';

/**
 * Injectable wrapper over field-crypto. Reads FIELD_ENCRYPTION_KEY once at
 * construction. When no key is configured it operates in PASSTHROUGH mode
 * (values stored as-is) and logs a warning, so a dev instance still boots — but
 * a production deployment MUST set the key.
 */
@Injectable()
export class EncryptionService {
  private readonly log = new Logger(EncryptionService.name);
  private readonly key: Buffer | null;

  constructor() {
    this.key = loadKey(process.env.FIELD_ENCRYPTION_KEY);
    if (!this.key) {
      this.log.warn(
        'FIELD_ENCRYPTION_KEY is not set — secret fields are stored in PLAINTEXT. ' +
          'Set a 32-byte key (64 hex chars or base64) in production.',
      );
    }
  }

  get enabled(): boolean {
    return !!this.key;
  }

  /** Encrypt a value. No-ops on null/empty and on already-encrypted input, and
   *  passes through unchanged when no key is configured. */
  encrypt(plaintext: string | null | undefined): string | null {
    if (plaintext == null || plaintext === '') return plaintext ?? null;
    if (isEncrypted(plaintext)) return plaintext;
    if (!this.key) return plaintext;
    return encryptWith(this.key, plaintext);
  }

  /** Decrypt a value. Legacy plaintext (no prefix) passes through unchanged. */
  decrypt(value: string | null | undefined): string | null {
    if (value == null || value === '') return value ?? null;
    if (!isEncrypted(value)) return value;
    if (!this.key) {
      throw new Error(
        'FIELD_ENCRYPTION_KEY is required to read encrypted secrets, but it is not set.',
      );
    }
    return decryptWith(this.key, value);
  }
}
