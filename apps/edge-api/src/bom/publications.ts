import { sql } from "drizzle-orm";

import type { AppDatabase } from "../../../../packages/db/src";

/**
 * Only a completed certificate with a verified digital signature may leave the
 * operational system. The manifest is the immutable source the recipient hashes.
 */
export function bomPublicationStatement(bullionItemId: string) {
  return sql`
    WITH certificate AS MATERIALIZED (
      SELECT certificate.id AS certificate_id, certificate.batch_id, certificate.assay_center_id,
        certificate.issue_year, certificate.sequence_no, certificate.manifest, certificate.document_hash,
        certificate.signed_at, certificate.signature_provider, certificate.provider_transaction_id,
        certificate.signature_algorithm, certificate.signature_value, certificate.signer_certificate, certificate.certificate_chain
      FROM bullion_intake_items selected
      JOIN bullion_intake_batches batch ON batch.id = selected.batch_id
      JOIN bullion_certificates certificate ON certificate.batch_id = batch.id
      JOIN organizations center ON center.id = certificate.assay_center_id
      JOIN customers customer ON customer.id = batch.customer_id
      WHERE selected.id = ${bullionItemId}::uuid AND batch.metal = 'gold'
        AND certificate.signature_status = 'signed' AND certificate.manifest IS NOT NULL AND certificate.document_hash IS NOT NULL
    ), ready AS MATERIALIZED (
      SELECT certificate.*,
        (SELECT max(examination.approved_at) FROM bullion_intake_items item
          JOIN LATERAL (
            SELECT approved_at FROM bullion_examination_revisions
            WHERE bullion_item_id = item.id AND status = 'approved'
            ORDER BY revision_no DESC LIMIT 1
          ) examination ON true
          WHERE item.batch_id = certificate.batch_id) AS approved_at
      FROM certificate
      WHERE NOT EXISTS (
        SELECT 1 FROM bullion_intake_items item
        LEFT JOIN LATERAL (
          SELECT status FROM bullion_examination_revisions
          WHERE bullion_item_id = item.id ORDER BY revision_no DESC LIMIT 1
        ) examination ON true
        WHERE item.batch_id = certificate.batch_id
          AND COALESCE(examination.status::text, 'draft') <> 'approved'
      )
    ), payload AS MATERIALIZED (
      SELECT *, jsonb_build_object('manifest', manifest, 'documentHash', document_hash,
        'signature', jsonb_build_object('provider', signature_provider, 'transactionId', provider_transaction_id,
          'algorithm', signature_algorithm, 'value', signature_value, 'signerCertificate', signer_certificate,
          'certificateChain', certificate_chain, 'signedAt', signed_at)) AS document
      FROM (
        SELECT ready.*, lpad(sequence_no::text, GREATEST(4, length(sequence_no::text)), '0') AS certificate_no
        FROM ready WHERE approved_at IS NOT NULL
      ) numbered
    )
    INSERT INTO integration.bom_certificate_publications (
      certificate_id, batch_id, assay_center_id, certificate_no, approved_at, payload, payload_hash
    )
    SELECT certificate_id, batch_id, assay_center_id, certificate_no, approved_at, document, document_hash
    FROM payload
    ON CONFLICT (certificate_id) DO NOTHING
  `;
}

/** Publish a completed, LE-approved bullion certificate outside a batch when needed by a reconciliation job. */
export async function publishBomCertificateIfReady(db: AppDatabase, bullionItemId: string): Promise<void> {
  await db.execute(bomPublicationStatement(bullionItemId));
}
