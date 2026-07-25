# Authentication (OIDC / Authentik)

OpenBooks is an OpenID Connect **relying party**. Any OIDC provider works
(Authentik, Keycloak, Google Workspace, Entra ID, Auth0). Authentik is the
recommended self-hosted option.

## First run without OIDC (break-glass admin)

If `OIDC_ISSUER_URL` is empty, the API bootstraps a local admin from
`BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`. Use this to get in,
create your first organization/company, then configure OIDC. Keep the local
admin as a recovery path even after OIDC is live.

## Wiring Authentik

1. Run Authentik (see its official docker-compose; it needs its own Postgres +
   Redis). A ready-made overlay lives at `docker-compose.authentik.yml` (TODO).
2. In Authentik, create an **OAuth2/OpenID Provider** and an **Application**:
   - Redirect URI: `${APP_URL}/api/auth/callback`
   - Scopes: `openid email profile groups`
3. Copy the issuer URL, client ID, and client secret into `.env`:
   ```
   OIDC_ISSUER_URL=https://auth.example.com/application/o/openbooks/
   OIDC_CLIENT_ID=...
   OIDC_CLIENT_SECRET=...
   ```
4. Map Authentik **groups** to OpenBooks roles (e.g. group `openbooks-admins`
   → role `Admin`). Group claims arrive in the token and are matched on login.

## Login flow

Authorization Code + PKCE. On first login the app just-in-time provisions a
local `app_user` keyed by the OIDC `sub`, reading `email`, `name`, and `groups`
claims. Authorization (what a user can do) is enforced by OpenBooks RBAC per
company — independent of the IdP. See `docs/DESIGN.md` §8.
