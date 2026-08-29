# Authentication

Authentication is app-owned because commercial banks, assay centers, and Bank
of Mongolia users need role-based access inside this system.

## Current Implementation

- `packages/security` contains password hashing and session-token utilities.
- `apps/edge-api/src/auth` contains auth routes, the Postgres auth store, and a local-only fallback store.
- `worker/index.ts` protects private browser routes before rendering the app.
- `apps/web/app/login` contains the Mongolian login page.

## Security Rules

- Passwords are never stored as plaintext.
- Session cookies are HTTP-only and SameSite=Lax.
- Session tokens are random and checked by SHA-256 hash.
- Anonymous users are redirected to `/login`.
- Protected API data returns `401` without a valid session.

## Production Store

When `DATABASE_URL` is present, authentication uses Postgres through the
`users`, `organizations`, `user_sessions`, `login_events`, and `audit_logs`
tables. This is the path intended for Neon and for any future Mongolia-hosted
Postgres deployment.

## First Admin Setup

An empty database can create the first `system_admin` through `/setup`.
The API requires a one-time setup token. Store only the SHA-256 base64url hash
of that token in `AUTH_SETUP_TOKEN_HASH`; do not store the raw token in source
control.

After the first admin exists, normal user creation must happen through
admin-created invitations.

## Invitations

Admins create invitations through `/api/auth/invitations`. The response returns
the raw invitation token once so it can be sent through a trusted channel. The
database stores only the token hash. Invited users finish registration through
`/invite?token=...`.

## Temporary Local Login

When `DATABASE_URL` is absent, local development can use a temporary in-memory
admin user only if `AUTH_DEV_LOGIN_ENABLED=true` and seed credentials are
provided. Do not commit real credentials.

Create `.dev.vars` from `.dev.vars.example` and choose a strong local password.
