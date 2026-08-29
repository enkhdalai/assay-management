# Neon setup

Use Neon Postgres as the production database, but keep the connection string out of git.

## Local `.dev.vars`

Create `/Users/enkhdalai/Development/webapps/assay-management/.dev.vars` from `.dev.vars.example`, then paste the real Neon password locally:

```env
DATABASE_URL="postgresql://neondb_owner:YOUR_REAL_PASSWORD@ep-lingering-star-az7db88e-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
AUTH_DEV_LOGIN_ENABLED=false
AUTH_SETUP_TOKEN_HASH="PASTE_HASH_FROM_SETUP_TOKEN_COMMAND"
```

## Generate first-admin setup token

```bash
npm run setup:token
```

Save the printed `SETUP_TOKEN` privately. Put only `AUTH_SETUP_TOKEN_HASH` into `.dev.vars` or Cloudflare secrets.

## Apply migrations to Neon

Load `.dev.vars` into the shell, then run the migration:

```bash
set -a
source .dev.vars
set +a
npm run db:migrate
```

After the migration succeeds, start the app and visit `/setup` to create the first real system admin.
