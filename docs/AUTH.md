# Authentication & Authorization

OpenBooks issues its own **session JWT** after a user authenticates through one
of three pluggable providers. The rest of the app only trusts the app session,
so providers are interchangeable (docs/DESIGN.md §8).

```
 provider (local | oidc | saml)  ->  AuthService  ->  app session JWT  ->  guards
```

## Providers

- **Local** — email + password (scrypt hashed). Always available; also powers
  the break-glass admin. `POST /api/auth/login`.
- **OIDC** — Authorization Code + PKCE against any OIDC issuer (Authentik,
  Keycloak, Entra ID, Google, Auth0). `GET /api/auth/oidc/start` →
  `GET /api/auth/oidc/callback`. Configure `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`,
  `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`.
  - Hardening TODO: verify the `id_token` signature against the issuer JWKS
    (currently claims are read post-exchange over TLS).
- **SAML 2.0** — scaffolded. Assertion→profile mapping is implemented and
  testable; wire `@node-saml/node-saml` into `SamlProvider` and set
  `SAML_ENTRY_POINT`, `SAML_CERT`, `SAML_ISSUER`, `SAML_CALLBACK_URL` to enable.

`GET /api/auth/providers` reports which are configured, so the UI can render the
right buttons.

## Sessions

`AuthService.issueSession` signs an HS256 JWT (`JWT_SECRET`, 8h TTL) carrying the
user id and email. Clients send it as `Authorization: Bearer <token>`.
`GET /api/auth/me` returns the user and their memberships. Logout is client-side
(discard the token); add a denylist if you need server-side revocation.

## Authorization (RBAC + tenancy)

Two global guards run on every route unless `@Public()`:

1. **JwtAuthGuard** — validates the session, sets `req.user`.
2. **PermissionsGuard** — if an `X-Company-Id` header is present, the user MUST
   have a membership in that company (this is the real tenant gate, since RLS
   trusts whatever company the service sets). If a route declares
   `@RequirePermissions('invoice:create', ...)`, the membership's role must
   satisfy them. System admins bypass.

Permission grammar: `*` (all), `invoice:*` (resource wildcard), `invoice:create`
(exact). Roles store a `permissions: string[]`.

## Break-glass admin

On first boot, if there are no users and `BOOTSTRAP_ADMIN_EMAIL` /
`BOOTSTRAP_ADMIN_PASSWORD` are set, a system-admin local user is created. Keep
this as a recovery path even after SSO is live; change the password immediately.

## Onboarding & the RLS bootstrap

Creating the first Organization/Company can't satisfy the company table's RLS
INSERT check (no company is selected yet). `OnboardingService` therefore runs on
a privileged connection (`ADMIN_DATABASE_URL`, a superuser/BYPASSRLS role) to
create org → owner → company → membership, then seeds the chart of accounts via
the normal RLS path. `POST /api/onboarding` is `@Public` for self-serve sign-up;
gate it behind an invite or restrict to admins per your policy.

The admin connection is used for exactly two things — auth membership reads and
onboarding — and nothing else. All business data access goes through the normal
RLS-enforced connection.
