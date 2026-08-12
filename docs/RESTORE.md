# Backup & restore runbook

The procedure below was **executed and verified** on `tcc-linux-vm1` on 2026-08-12.
Everything here is proven, not theoretical — including the one ordering detail that
silently breaks a naive restore.

> A backup that has never been restored is not a backup. Re-run the drill in §3 after
> any change to the schema or the deploy topology.

## 1. Take a backup

```bash
cd ~/openbooks && STAMP=$(date -u +%FT%H%M%SZ)

docker compose exec -T postgres pg_dump -U openbooks -d openbooks -Fc \
  > ~/openbooks-backups/openbooks-$STAMP.dump
docker compose exec -T postgres pg_dump -U openbooks -d openbooks \
  | gzip > ~/openbooks-backups/openbooks-$STAMP.sql.gz
docker compose exec -T postgres pg_dumpall -U openbooks --globals-only \
  > ~/openbooks-backups/globals-$STAMP.sql
docker run --rm -v openbooks_miniodata:/d:ro -v ~/openbooks-backups:/b alpine \
  tar czf /b/minio-$STAMP.tgz -C /d .
```

Four artifacts, and **you need all four**:

| Artifact | Why it is not optional |
|---|---|
| `openbooks-*.dump` | The data. Custom format, so `pg_restore` can be selective. |
| `globals-*.sql` | The **roles**, including `openbooks_app`. See §2 — without this the restore looks fine and isn't. |
| `minio-*.tgz` | Attachments. Postgres stores only object keys; a DB-only restore yields broken download links. |
| `.env` (encrypted) | `FIELD_ENCRYPTION_KEY`. See §4. |

## 2. ⚠️ Restore order: globals *before* data

`pg_restore` of the data dump alone produces **34 errors**, all of them
`role "openbooks_app" does not exist` — every `GRANT` in the dump fails.

This is the dangerous failure mode, because the row counts still come out
**correct**. It looks like a clean restore. What is actually missing is the grant
structure that RLS depends on, and the app then connects as a role that either
doesn't exist or lacks the right privileges.

Load roles first:

```bash
psql -U openbooks -d postgres < globals-$STAMP.sql   # "role openbooks already exists" is benign
pg_restore -U openbooks -d openbooks --no-owner < openbooks-$STAMP.dump
```

Done in that order the restore is clean.

## 3. Verify — the drill

Never restore into the live database to test. Use a scratch container:

```bash
docker run -d --name pgverify -e POSTGRES_PASSWORD=x \
  -e POSTGRES_USER=openbooks -e POSTGRES_DB=openbooks postgres:16-alpine
until docker exec pgverify pg_isready -U openbooks -q; do sleep 2; done

docker exec -i pgverify psql -U openbooks -d postgres -q < ~/openbooks-backups/globals-$STAMP.sql
docker exec -i pgverify pg_restore -U openbooks -d openbooks --no-owner \
  < ~/openbooks-backups/openbooks-$STAMP.dump
```

### Acceptance criteria

Structural — these must hold for *any* restore:

```bash
# 27 tables with RLS enabled
docker exec pgverify psql -U openbooks -d openbooks -tAc \
  "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname=current_schema and c.relrowsecurity"

# 5 non-internal triggers (balance, immutability, closed-period guards)
docker exec pgverify psql -U openbooks -d openbooks -tAc \
  "select count(*) from pg_trigger where not tgisinternal"

# the app role must be NEITHER superuser NOR bypassrls, or RLS is silently off
docker exec pgverify psql -U openbooks -d openbooks -tAc \
  "select rolsuper, rolbypassrls from pg_roles where rolname='openbooks_app'"
```

Expected: `27`, `5`, `f | f`.

That last one is the whole ballgame. A superuser or `BYPASSRLS` role makes every
tenant policy a no-op, and nothing in the app will tell you.

Data — compare against the live counts *at the time the dump was taken*:

```bash
docker exec pgverify psql -U openbooks -d openbooks -tAc \
  "select (select count(*) from journal_line), (select count(*) from account),
          (select count(*) from audit_log), (select count(*) from vendor),
          (select count(*) from company)"
```

Verified on 2026-08-12: `45 | 798 | 883 | 403 | 4`.

Then tear it down: `docker rm -f pgverify`.

## 4. The encryption key

`FIELD_ENCRYPTION_KEY` in `~/openbooks/.env` encrypts **SSNs, bank tokens and EINs**.
It currently exists in exactly one place, on the same disk as the database.

Lose the host and a *perfectly good* database dump is still partly permanently
unreadable — the ciphertext survives, the key does not. Store it in a password
manager, off this host, and encrypt `.env` into the backup set:

```bash
tar czf - -C ~/openbooks .env .deploy-secrets \
  | gpg --symmetric --cipher-algo AES256 -o ~/openbooks-backups/secrets-$STAMP.tgz.gpg
```

There is also **no re-encryption pass in the codebase**, so this key cannot currently
be rotated without losing the data it protects. Treat it as permanent until that
exists.

## 5. Known gaps

These are open items, tracked in [`BACKLOG.md`](BACKLOG.md) as X1–X9:

- **The nightly restic job does not back up OpenBooks.** It targets
  `/mnt/data/personal-apps` (rustdesk) and a `$STACK` path that does not exist, and
  it has reported success every night while capturing ~206 KiB. Until it is
  repointed at `/mnt/data/docker/volumes` and `~/openbooks-backups`, **the only
  backups that exist are the ones taken by hand via §1** — and they live on the same
  disk as the data, which is not a backup.
- No PITR: `archive_mode=off`, so recovery granularity is whatever your last dump was.
- `scripts/apply-sql-migrations.sh` applies 3 of the 5 files in `api/prisma/sql/` —
  `0003_contact_fields.sql` and `0004_payment_terms.sql` are never applied. A
  rebuild-from-repo therefore produces a database missing objects the live one has,
  including the `payment_term` RLS policy. Fix before relying on a from-scratch rebuild.
