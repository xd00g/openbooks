# Field encryption: key rotation and key protection

Design note for fixing the two open problems with `FIELD_ENCRYPTION_KEY`:

1. It cannot be rotated without destroying the data it protects.
2. It exists as plaintext in one file, on the same disk as that data.

These are independent. (1) is a code change; (2) is a deployment change. Do (1) first —
rotation is what makes every other key-handling mistake recoverable.

## What's encrypted

Five columns, all AES-256-GCM at the app layer:

| Column | Table |
|---|---|
| `ein` | `company` |
| `taxId` | `vendor` |
| `accessToken` | bank connection |
| `ssnEncrypted` | `employee` |
| `bankAccountEncrypted` | `employee` |

At current volume that's on the order of a few hundred rows. **That number matters** — it
means the simple design below is sufficient, and envelope encryption would be
over-engineering.

## 1. Rotation

### Why it's currently impossible

The ciphertext envelope is already versioned:

```
enc:v1:<base64 iv>:<base64 tag>:<base64 ciphertext>
```

But `v1` is the *format* version, not the *key*. Nothing in a stored value says which key
encrypted it. So with two keys in play you cannot tell, for any given row, which one to
try — and a wrong key fails GCM authentication rather than returning garbage.

That last part is worth calling out as a strength: the scheme **fails closed**. A wrong
key throws instead of silently producing corrupt plaintext. The rotation design below
relies on that.

### The fix: put a key id in the envelope

```
enc:v2:<keyId>:<base64 iv>:<base64 tag>:<base64 ciphertext>
```

Config becomes a keyring rather than a single key:

```sh
# id:base64key, comma-separated. Ids are arbitrary short labels.
FIELD_ENCRYPTION_KEYS="2026a:Base64Key…,2026b:Base64Key…"
# which key new writes use
FIELD_ENCRYPTION_ACTIVE_KEY_ID=2026b
```

- **Encrypt** always uses the active key, and stamps its id.
- **Decrypt** reads the id from the value and looks it up in the keyring.
- **Legacy `enc:v1:`** values have no id — map them to a reserved id (`v1`) supplied as
  `FIELD_ENCRYPTION_KEYS="v1:<the current key>,…"`. No data migration is needed to adopt
  the new format; v1 values keep decrypting until the re-encrypt job upgrades them.

Both keys are readable simultaneously during a rotation, which is what makes it a
zero-downtime, zero-data-loss operation.

### The rotation procedure

```
1. Generate a new key.        openssl rand -base64 32
2. Add it to FIELD_ENCRYPTION_KEYS alongside the old one. Do NOT change the active id.
3. Restart. Nothing changes yet — the app can now read both, still writes with the old.
4. Flip FIELD_ENCRYPTION_ACTIVE_KEY_ID to the new id. Restart.
   New writes use the new key; old rows still decrypt under the old one.
5. Run the re-encrypt job. It walks each encrypted column, decrypts with whatever key the
   value names, re-encrypts under the active key, writes back.
6. Verify no value still names the old key id, then drop the old key from the keyring.
```

Steps 2–4 are individually reversible: until step 5 completes, removing the new key and
flipping the active id back restores the previous state exactly.

**Rollback after step 5** is the case people get wrong. Once a row is re-encrypted, the
old key alone can no longer read it — so **the old key must stay in the keyring until
step 6 is deliberately performed**, and it must not be deleted from escrow until a
backup taken *after* rotation has been restore-tested. A backup taken before rotation
requires the old key to read; a backup taken after requires the new one. Retire a key
only when no surviving backup depends on it.

### The re-encrypt job

`scripts/backfill-encryption.ts` already exists and does the plaintext→v1 pass. Generalise
it to `scripts/rekey-encryption.ts`:

- Idempotent and resumable — safe to re-run after an interruption. Skip any value already
  naming the active key id.
- Row-at-a-time transactions, not one big one. A few hundred rows means a partial run is
  cheap to resume, and a long transaction on a live DB is worse than a slow job.
- Runs on the **admin (RLS-bypassing)** connection, because it must span every tenant.
- Dry-run mode that reports counts per key id and decrypts without writing. Run it first —
  it proves every row is readable before anything is modified.
- Never write a value it could not decrypt. On failure, log the table, id and key id, and
  keep going; a single unreadable row must not abort the run or, worse, get overwritten.

### Tests worth having

- Round-trip under a rotated keyring: encrypt with `A`, add `B`, flip active, decrypt still
  works; re-encrypt, and the value now names `B`.
- A `v1` legacy value decrypts under the mapped id and upgrades to `v2`.
- Decrypt with a key id absent from the keyring raises a clear error naming the id, rather
  than a generic auth failure.
- Wrong key for a known id still fails closed (GCM auth), never returns plaintext.
- The rekey job is idempotent: running it twice produces identical values the second time.

### Why not envelope encryption (DEK/KEK)

The textbook answer is per-row data keys wrapped by a master key, so rotating the master
only re-wraps keys and never touches data ciphertext — O(keys) instead of O(rows).

That is the right design at millions of rows. Here it adds a second key table, a caching
layer, and a wrapping format to protect a few hundred rows that re-encrypt in seconds. The
keyring above gets the same operational property (rotate without downtime or data loss) at
a fraction of the complexity. Revisit if the encrypted-row count grows by orders of
magnitude, or if you ever need per-tenant key isolation — that's the real reason to adopt
envelope encryption, not performance.

## 2. Protecting the key

Ranked by how much they actually change the threat model. The keyring above works with all
of them — it only cares that key material reaches the process.

### Baseline (do regardless)

- **Fail fast when unset.** Today `EncryptionService` degrades to **plaintext passthrough**
  with a log warning, and `listEmployees` returns whole rows including `ssnEncrypted` to
  anyone holding `payroll:view` — which the default Read-only role has. A misconfigured
  restart silently starts writing SSNs in the clear. Refuse to boot instead. *(Backlog S7.)*
- **Escrow a copy offline**, in a password manager or a sealed envelope, independent of
  both the host and the backup repo. Encryption converts a confidentiality problem into an
  availability problem: lose the key and the data is gone as surely as if the disk failed.
- **Never log or echo it.** Redact it from error dumps and support bundles.

### Option A — encrypted secrets file (single host, no new infra)

Keep `.env` but encrypt it at rest with [`sops`](https://github.com/getsops/sops) or
[`age`](https://github.com/FiloSottile/age); decrypt at container start. On Azure the sops
key can be an Azure Key Vault key, so the plaintext never lands on disk.

Better than today, but the decrypted value still passes through the host, and access isn't
audited. Reasonable for a self-hoster; not sufficient for holding other people's SSNs.

### Option B — Azure Key Vault + Managed Identity (recommended here)

The VM is already on Azure, so this is the natural fit and needs no new credentials:

- Key material never touches the host disk. The app fetches it at boot over the instance's
  **managed identity** — there is no bootstrap secret to protect, which is the usual
  weakness of secret managers.
- Access is **logged and revocable**. You get an audit trail of every fetch, and can cut
  access instantly without touching the VM.
- Rotation becomes an operation on the vault plus a restart, rather than an edit to a file
  on a box.

Combine with the keyring: store each key as a separate vault secret, and let
`FIELD_ENCRYPTION_KEYS` name the vault entries instead of carrying raw material.

Caveat worth stating plainly: the process still holds the key in memory. Anyone with root
on the host, or a code-execution bug in the API, can read it. Key Vault protects against
disk theft, stray backups, and over-broad file access — not against host compromise. That
is still most of the realistic risk.

### Option C — a KMS that never releases the key

AWS KMS, Azure Managed HSM, or Vault's transit engine perform encrypt/decrypt *inside* the
service; the key never leaves it. Host compromise then yields an oracle rather than the key
itself, and every use is logged.

The cost is a network round trip per field decrypt, which matters on list endpoints that
decrypt many rows. The usual resolution is envelope encryption — cache a decrypted DEK,
call the KMS only to unwrap. Note that this is the point where envelope encryption
genuinely earns its complexity, which is a reason to keep the envelope format extensible
now even if you don't build it.

### Because this ships to self-hosters

OpenBooks is AGPL software other people will run, so the key source should be pluggable
behind a small interface — `env` (default, works with plain Docker), `file`, `azure-kv`,
`aws-kms` — resolved once at boot into the keyring. A self-hoster on a NAS should not need
a cloud KMS to run the product, and this deployment should not be stuck with a file on
disk.

## Recommended order

1. **Fail fast on a missing key** (S7). Small, and it closes the silent-plaintext hole that
   makes every other step conditional. — S
2. **Keyring + `enc:v2:` + generalised rekey job**, with `v1` mapped as a legacy id. This is
   the change that makes the key rotatable at all. — M
3. **Escrow the current key** off-host. Do this today; it needs no code. — S
4. **Azure Key Vault + managed identity**, behind a pluggable provider interface. — M
5. Revisit envelope encryption only on per-tenant key isolation or a large growth in
   encrypted rows. — L, not now

Steps 1–3 remove the data-loss risk. Step 4 removes the disk-exposure risk. Nothing before
step 2 should be treated as "the key is rotatable", because until then it isn't.

## One thing this does not solve

Encrypted columns are not searchable or joinable. Any future "look up a vendor by tax id"
or "find the employee with this SSN" needs a **blind index** — a keyed HMAC of the
normalised plaintext, stored alongside — which is itself keyed material with its own
rotation problem, and rotating it requires re-indexing every row. Worth knowing before
someone files that as a small feature request.
