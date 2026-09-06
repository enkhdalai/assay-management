# BOM Assay Integration

## Data boundary

Operational intake, sampling, and chemistry data remain in the `public` schema.
Only after the laboratory director approves every bullion examination in a gold
batch is a certificate snapshot written to `integration.bom_certificate_publications`.
The BOM API reads only that table. The planned commercial-bank entitlement table
is `integration.bank_certificate_access` and is not exposed by any API yet.

## BOM API

`GET /api/bom/v1/bullion-certificates`

Optional filters: `from`, `to`, `assayCenterCode`, `certificateNo`,
`registrationNo`, and `limit` (1-250). A certificate can be retrieved by its
UUID at `GET /api/bom/v1/bullion-certificates/:certificateId`.

Requests require the existing HMAC headers and an active `bank_of_mongolia`
API client with scope `bom:bullion-certificates:read`.

## Deployment configuration

Apply database migrations before enabling the integration endpoint. Then set
the same client identifier and signing secret in both systems:

- Assay Edge API: `BOM_API_CLIENT_ID`, `BOM_API_SIGNING_SECRET`
- BOM Grails app: `BOM_ASSAY_API_URL`, `BOM_ASSAY_CLIENT_ID`,
  `BOM_ASSAY_SIGNING_SECRET`

The Grails app requires `ROLE_BOM_ASSAY` for `/bomassay/index`. The API should
be served over HTTPS and its API-client IP allowlist should contain only the
BOM egress addresses.
