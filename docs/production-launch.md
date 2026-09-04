# Production Launch Runbook

This application must not be deployed as a public self-signup website. Complete every item below before inviting an assay center, commercial bank, or Bank of Mongolia user.

## 1. Database

1. Create a dedicated Neon production project and production role. Do not reuse the local connection string.
2. Require TLS in the database URL.
3. Run `npm run db:migrate` from a controlled release workstation.
4. Enable Neon point-in-time recovery or an equivalent backup policy, then test a restore before go-live.

## 2. Secrets and environment

Generate the data-encryption key once, store it in the approved secret manager, and keep an offline recovery copy under the organization’s key-management policy:

```bash
npm run security:field-key
```

Configure these production variables. Do not put secret values in source control, `.dev.vars`, browser code, screenshots, or support tickets.

| Variable | Production value |
| --- | --- |
| `APP_ENV` | `production` |
| `DATABASE_URL` | Neon production TLS URL |
| `FIELD_ENCRYPTION_KEY` | Generated 32-byte base64url secret |
| `AUTH_SETUP_TOKEN_HASH` | Hash of a one-time initial setup token |
| `AUTH_DEV_LOGIN_ENABLED` | `false` |
| `RATE_LIMITING_ENABLED` | `true` |

## Resetting an initial password

Cloudflare Workers support PBKDF2 password verification up to 100,000 iterations.
If an early account was created with a higher count, reset it locally after the
application update. Do not put the password in a file or shell history:

```bash
read -s "ASSAY_RESET_PASSWORD?New password: "
export ASSAY_RESET_PASSWORD
npm run auth:reset-password -- --email=admin@example.mn
unset ASSAY_RESET_PASSWORD
```
| `BOM_API_CLIENT_ID` | Leave unset until BOM integration is formally approved |
| `BOM_API_SIGNING_SECRET` | Leave unset until BOM integration is formally approved |

Use Cloudflare Worker secrets for `DATABASE_URL`, `FIELD_ENCRYPTION_KEY`, `AUTH_SETUP_TOKEN_HASH`, and the future BOM credentials. Keep only non-secret environment flags in the deployment configuration.

## 3. Cloudflare access controls

1. Put the staff application behind Cloudflare Access before creating normal users. Permit only the named assay-center and central-bank identity groups.
2. Require MFA in the identity provider for all privileged roles, especially `system_admin`, `assay_admin`, and `lab_manager`.
3. Create Cloudflare WAF rate-limiting rules at minimum for `/api/auth/login`, `/api/setup/*`, `/api/auth/invitations/*`, and `/api/bom/*`.
4. Enable managed WAF rules and review the event log during the pilot period.
5. Do not use a global IP allow rule for staff offices: it can bypass other Cloudflare security controls. Use Access policy groups and narrowly scoped rules instead.

Suggested starting limits, to be tuned from real traffic:

| Path | Characteristic | Limit | Action |
| --- | --- | --- | --- |
| `/api/auth/login` | IP | 5 requests / 15 minutes | Block 15 minutes |
| `/api/setup/*` | IP | 3 requests / hour | Block 1 hour |
| `/api/auth/invitations/*` | IP | 10 requests / hour | Block 1 hour |
| `/api/bom/*` | API client/IP | 120 requests / minute | Block 5 minutes |

## 4. Application controls

- Confirm the production health endpoint returns `200`. It intentionally returns `503` if development login, rate limiting, the production database, or the encryption key is missing.
- Create the initial super admin with the setup token, then rotate the setup token immediately.
- Invite named users only. Review roles before acceptance; commercial-bank users must remain read-only.
- Verify a chemist cannot approve their own result, and that a commercial bank cannot retrieve another bank’s allocation.
- Keep the Bank of Mongolia API disabled until its signed contract, client identity, allowlist, HMAC verification test, replay test, and incident contacts are complete.

## 5. Operational readiness

- Assign an owner for daily audit-log review and an owner for user-offboarding.
- Test a lost-password, locked-account, revoked-session, and compromised-user procedure.
- Set security-alert routing for failed logins, WAF events, and Neon availability alerts.
- Establish a release process: staging migration, backup verification, approval, production migration, smoke test, and rollback decision.
- Schedule an independent penetration test before onboarding Bank of Mongolia or accepting production bullion records.

## Encryption and key rotation

New sensitive values are stored using authenticated AES-256-GCM encryption. Existing legacy masked values remain readable as masked values; they cannot be recovered because they were never stored as raw encrypted data.

Do not rotate `FIELD_ENCRYPTION_KEY` by simply replacing the secret. A safe rotation requires a controlled migration that decrypts every current `v1` value with the old key and re-encrypts it with the new key, followed by verification and retirement of the old key.
