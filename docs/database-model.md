# Database Model

The database model is Postgres-first and is designed for Neon now, with a path
to a Mongolia-hosted Postgres later if data residency becomes mandatory.

## Core Ownership

- `organizations` stores assay centers, Bank of Mongolia, commercial banks, and system operators.
- `users`, `user_invitations`, `user_sessions`, and `login_events` support invite-based authentication and account security.
- `user_organization_access` allows controlled cross-organization access when an auditor or operator needs it.

## Assay Workflow

- `customers` stores customer identity with encrypted PII fields and hash fields for lookup.
- `assay_records` is the top-level intake record.
- `assay_samples` stores sample/seal/container details.
- `assay_result_revisions` stores lab results as revisions, not overwrites.
- `bank_allocations` stores the grams assigned to each commercial bank at intake.

## Bank of Mongolia and Banks

- `bom_submissions` logs outbound submissions with idempotency and payload hashes.
- `bom_confirmations` stores Bank of Mongolia confirmation versions for the assay record.
- `bom_confirmation_allocations` stores the per-bank calculated amount from the confirmed result.
- `bank_settlements` stores the final commercial bank settlement record.

## Integrity and Security

- Approved values should be locked in application logic and changed only through `correction_requests`.
- Maker-checker constraints prevent the same user from entering and approving sensitive result/correction rows.
- `audit_logs` stores hash-chained audit entries for sensitive actions.
- `api_clients` and `api_request_logs` support signed Bank of Mongolia API access, scoped clients, IP allowlists, idempotency, and request/response hashing.

## File Storage

No image/document blob table is included yet. If certificates or attachments become required, store bytes in object storage and store only metadata plus hashes in Postgres.
