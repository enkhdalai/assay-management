# Assay Management Architecture

This project uses a monorepo layout so the private admin website can grow
without mixing interface code, edge API code, database code, and security rules.

## Layout

- `apps/web` - Mongolian admin UI and route components.
- `apps/edge-api` - Hono API routes for internal app calls, Bank of Mongolia integration, and commercial bank read-only access.
- `packages/db` - database schema, migrations, and query helpers.
- `packages/shared` - shared business types and constants.
- `packages/security` - role, permission, audit, and signing helpers.
- `worker` - Cloudflare/Vinext adapter that composes the web app and edge API.

## Dependency direction

`apps/web` calls the API. It must not connect directly to the database.

`apps/edge-api` owns request validation, auth checks, audit logging, and calls
`packages/db`.

`packages/db` owns the source-of-truth model. Production database connection
details will be added after the DB model, auth, screens, API, and security
hardening are implemented.
