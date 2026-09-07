import { sql } from "drizzle-orm";

import type { AppDatabase } from "../../../../packages/db/src";

/**
 * Builds an insert that publishes only a fully LE-approved gold batch. Keeping
 * this in the approval transaction prevents a certificate from being visible
 * to an integration before its final approval is committed.
 */
export function bomPublicationStatement(bullionItemId: string) {
  return sql`
    WITH certificate AS MATERIALIZED (
      SELECT certificate.id AS certificate_id, certificate.batch_id, certificate.assay_center_id,
        certificate.issue_year, certificate.sequence_no, certificate.entries,
        batch.public_id AS registration_no, batch.metal, batch.received_at,
        center.name AS assay_center_name, center.code AS assay_center_code,
        customer.display_name AS customer_name
      FROM bullion_intake_items selected
      JOIN bullion_intake_batches batch ON batch.id = selected.batch_id
      JOIN bullion_certificates certificate ON certificate.batch_id = batch.id
      JOIN organizations center ON center.id = certificate.assay_center_id
      JOIN customers customer ON customer.id = batch.customer_id
      WHERE selected.id = ${bullionItemId}::uuid AND batch.metal = 'gold'
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
      SELECT *, jsonb_build_object(
        'certificateId', certificate_id,
        'certificateNo', certificate_no,
        'certificateYear', issue_year,
        'sequenceNo', sequence_no,
        'assayCenter', jsonb_build_object('id', assay_center_id, 'name', assay_center_name, 'code', assay_center_code),
        'registrationNo', registration_no,
        'customerName', customer_name,
        'metal', metal,
        'receivedAt', received_at,
        'approvedAt', approved_at,
        'entries', entries
      ) AS document
      FROM (
        SELECT ready.*, lpad(sequence_no::text, GREATEST(4, length(sequence_no::text)), '0') AS certificate_no
        FROM ready WHERE approved_at IS NOT NULL
      ) numbered
    )
    INSERT INTO integration.bom_certificate_publications (
      certificate_id, batch_id, assay_center_id, certificate_no, approved_at, payload, payload_hash
    )
    SELECT certificate_id, batch_id, assay_center_id, certificate_no, approved_at, document,
      encode(sha256(convert_to(document::text, 'UTF8')), 'hex')
    FROM payload
    ON CONFLICT (certificate_id) DO NOTHING
  `;
}

/** Publish a completed, LE-approved bullion certificate outside a batch when needed by a reconciliation job. */
export async function publishBomCertificateIfReady(db: AppDatabase, bullionItemId: string): Promise<void> {
  await db.execute(bomPublicationStatement(bullionItemId));
}
