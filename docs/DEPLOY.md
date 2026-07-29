# Deploying OpenBooks (single host, Docker Compose)

This runbook takes a Linux host that previously ran other Docker stacks, wipes
it, and brings up OpenBooks fresh. It assumes a Debian/Ubuntu-style VM (e.g.
`tcc-linux-vm1`) reachable over SSH/Tailscale.

> Take a VM snapshot before you start. Step 1 is destructive.

---

## 0. Prerequisites

- Docker Engine + the Compose plugin. Verify:
  ```bash
  docker --version && docker compose version
  ```
  If missing: `curl -fsSL https://get.docker.com | sudo sh` then
  `sudo usermod -aG docker "$USER"` and re-login.
- `git`, `openssl`, and `curl` available.

---

## 1. Wipe the old Docker stack

You've already migrated the other apps off this host, so clear everything:

```bash
# from the OpenBooks repo (see step 2) or copy the script over first
chmod +x scripts/cleanup-docker.sh
./scripts/cleanup-docker.sh            # prune all apps + data, keep Docker
# or, for a fully pristine engine:
# ./scripts/cleanup-docker.sh --reinstall
```

It prints the current state, requires you to type `WIPE`, then removes all
containers, images, volumes, networks, and build cache. It does **not** delete
bind-mounted data directories on the host disk — if your old stacks stored data
under `/opt/<app>`, `/srv`, or a home dir, remove those manually. Find large
dirs with:

```bash
sudo du -xhd1 / | sort -h | tail -20
```

---

## 2. Get OpenBooks onto the host

**Option A — git remote (best for ongoing updates).** Push the repo to
GitHub/Gitea/etc. from your workstation, then on the VM:

```bash
git clone <your-remote-url> ~/openbooks && cd ~/openbooks
```

**Option B — portable bundle (no remote yet).** Copy the bundle over and clone
from it:

```bash
# from your workstation:
scp openbooks.bundle tcc-azure@100.79.15.126:~/
# on the VM:
git clone openbooks.bundle openbooks && cd openbooks
```

---

## 3. Configure `.env`

```bash
cp .env.example .env
```

Generate strong secrets and set them in `.env`:

```bash
echo "JWT_SECRET=$(openssl rand -base64 48)"
echo "FIELD_ENCRYPTION_KEY=$(openssl rand -base64 32)"
echo "POSTGRES_PASSWORD=$(openssl rand -base64 24)"
echo "S3_SECRET_KEY=$(openssl rand -base64 24)"
echo "APP_ROLE_PASSWORD=$(openssl rand -base64 24)"   # for openbooks_app
```

Then edit `.env` and make these consistent:

- `POSTGRES_PASSWORD` → also used in `ADMIN_DATABASE_URL`
  (`postgresql://openbooks:<POSTGRES_PASSWORD>@postgres:5432/openbooks?schema=public`).
- `DATABASE_URL` → `postgresql://openbooks_app:<APP_ROLE_PASSWORD>@postgres:5432/openbooks?schema=public`.
- The **same** `<APP_ROLE_PASSWORD>` goes into `scripts/create-app-role.sql`
  (the `\set app_password` line) in step 5.
- `APP_URL` → how browsers reach the host, e.g. `http://100.79.15.126` (Tailscale)
  or `https://books.yourdomain.com`.
- `OIDC_REDIRECT_URI` / `SAML_CALLBACK_URL` → `${APP_URL}/api/auth/...` if using SSO.
- Set `NODE_ENV=production` and a real `BOOTSTRAP_ADMIN_EMAIL` / password.

> Why two DB URLs: the app runs as the **non-superuser** `openbooks_app` so
> PostgreSQL RLS is actually enforced (a superuser bypasses it). The superuser
> URL (`ADMIN_DATABASE_URL`) is used only for migrations and the onboarding/auth
> path. See `docs/DESIGN.md` §4.2 and §17.

---

## 4. Build images and start the data tier

```bash
docker compose build
docker compose up -d postgres redis minio minio-init
docker compose ps      # wait until postgres + minio are healthy
```

---

## 5. Create the schema, constraints, and app role

Order matters — schema first, then the DB-level guarantees, then the runtime
role.

```bash
# 5a. Create tables from the Prisma schema (first-time init).
#     (Later, use committed migrations: `docker compose run --rm migrate npx prisma migrate deploy`.)
docker compose run --rm migrate            # runs `prisma db push` as the admin role

# 5b. Apply the RLS policies + ledger/immutability/closed-period triggers.
docker compose exec -T postgres \
  psql -U openbooks -d openbooks < api/prisma/sql/accounting_core_constraints.sql

# 5c. Create the non-superuser runtime role. Edit the password in the file first
#     so it matches APP_ROLE_PASSWORD / DATABASE_URL.
nano scripts/create-app-role.sql          # set \set app_password '...'
docker compose exec -T postgres \
  psql -U openbooks -d openbooks < scripts/create-app-role.sql
```

The last command prints the role with `rolsuper = f` and `rolbypassrls = f` —
confirm both are false.

---

## 6. Start the application tier

```bash
docker compose up -d api worker web caddy
docker compose ps
docker compose logs -f api        # watch it boot; Ctrl-C to stop tailing
```

The API seeds a break-glass admin from `BOOTSTRAP_ADMIN_EMAIL` /
`BOOTSTRAP_ADMIN_PASSWORD` on first boot (no users yet).

---

## 7. Verify

```bash
curl -fsS http://localhost:3000/health         # {"status":"ok","db":"up",...}
```

Then in a browser at `APP_URL`:

1. Sign in with the bootstrap admin, **or**
2. Create the first organization + company:
   ```bash
   curl -sX POST "$APP_URL/api/onboarding" -H 'content-type: application/json' -d '{
     "organizationName":"Acme Holdings",
     "company":{"legalName":"Acme LLC","baseCurrency":"USD","country":"US"},
     "owner":{"email":"you@acme.com","fullName":"You","password":"a-strong-password"}
   }'
   ```
   This also seeds the chart of accounts. Log in and you're live.

---

## 8. Object-storage CORS (attachments)

Browser uploads PUT directly to MinIO via presigned URLs, so the bucket needs
CORS allowing your web origin:

```bash
docker compose exec minio sh -c "\
  mc alias set local http://localhost:9000 $S3_ACCESS_KEY $S3_SECRET_KEY && \
  mc cors set local/openbooks --rule 'AllowedOrigin=$APP_URL,AllowedMethod=PUT,AllowedMethod=GET,AllowedHeader=*'"
```

(Exact `mc cors` syntax varies by MinIO version; confirm with `mc cors --help`.)

---

## 9. Hardening (do before real data)

- **Don't publish internal ports.** For production, remove the host `ports:` on
  `postgres`, `redis`, and `minio` in `docker-compose.yml` (they talk over the
  compose network); expose only Caddy (80/443). Keep a `docker-compose.prod.yml`
  override for this.
- **TLS / domain.** Point a DNS name at the host and set the site address in
  `Caddyfile` (replace `:80` with `books.yourdomain.com`); Caddy auto-provisions
  Let's Encrypt certs. Over Tailscale-only, you can use Caddy with a Tailscale
  cert or just run HTTP on the tailnet.
- **Firewall.** Restrict inbound to SSH + 80/443 (or keep everything on the
  tailnet and expose nothing publicly).
- Rotate the bootstrap admin password after first login.

---

## 10. Backups & updates

**Backup** (nightly cron):

```bash
docker compose exec -T postgres pg_dump -U openbooks openbooks | gzip > openbooks-$(date +%F).sql.gz
# plus the MinIO data volume (attachments): docker run --rm -v openbooks_miniodata:/d -v "$PWD":/b alpine tar czf /b/minio-$(date +%F).tgz -C /d .
```

**Update:**

```bash
git pull                        # or clone a newer bundle
docker compose build
docker compose run --rm migrate npx prisma migrate deploy   # apply new migrations
docker compose up -d
```

---

## Notes

- CI (`.github/workflows/ci.yml`) runs unit tests, the real-Postgres integration
  test, typecheck, and the web build on every push — run it green before deploying.
- First-time `db push` creates the schema without a migration history. For
  change management, generate a baseline migration on a dev machine
  (`npx prisma migrate dev --name init`), commit it, and use `migrate deploy`
  thereafter.
