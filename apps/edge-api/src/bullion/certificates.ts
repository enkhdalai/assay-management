import { sql } from "drizzle-orm";
import type { AppDatabase } from "../../../../packages/db/src";
import { sha256Base64Url, type AuthenticatedUser } from "../../../../packages/security/src";
import type { CertificateEntry } from "../../../../packages/shared/src/bullion-types";

type Certificate = { issueYear: number; sequenceNo: number; issuedAt: string; entries: CertificateEntry[] };
const rows = <T,>(result: T[] | { rows: T[] }) => Array.isArray(result) ? result : result.rows;

export async function issueCertificate(db: AppDatabase, user: AuthenticatedUser, batchId: string) {
  const hash = await sha256Base64Url(JSON.stringify({ batchId, actor: user.id, nonce: crypto.randomUUID() }));
  // Serialize issuance with examination saves. The number and report snapshot commit together.
  const result = await db.batch([
    db.execute(sql`SELECT pg_advisory_xact_lock(741206825)`),
    db.execute<Certificate>(sql`
      WITH batch AS MATERIALIZED (
        SELECT b.*, EXTRACT(YEAR FROM CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ulaanbaatar')::integer AS issue_year
        FROM bullion_intake_batches b JOIN organizations o ON o.id = b.assay_center_id
        WHERE b.id = ${batchId}::uuid AND b.assay_center_id = ${user.organizationId}::uuid AND b.status = 'sample_taken'
          AND o.type IN ('private_assay_center', 'government_assay_center')
      ), existing AS MATERIALIZED (
        SELECT c.* FROM bullion_certificates c JOIN batch b ON b.id = c.batch_id
      ), results AS MATERIALIZED (
        SELECT i.sequence_no, i.sample_weight_milligrams > 0 AND i.gross_weight_after_grams IS NOT NULL
          AND e.status = 'approved' AND e.gold_result IS NOT NULL AND e.silver_result IS NOT NULL
          AND e.measurement_entries->1->>'reading' IS NOT NULL
          AND e.measurement_entries->2->>'reading' IS NOT NULL
          AND e.measurement_entries->3->>'reading' IS NOT NULL AS ready,
          jsonb_build_object('analysisNo', i.examination_number::text, 'bullionNo', i.bullion_no,
            'bullionWeightGrams', i.gross_weight_after_grams::float, 'origin', b.dispatch_reference,
            'sampleWeightMilligrams', i.sample_weight_milligrams::float,
            'remainingMilligrams', (e.measurement_entries->1->>'reading')::float,
            'lossMilligrams', (e.measurement_entries->2->>'reading')::float,
            'returnedMilligrams', (e.measurement_entries->3->>'reading')::float,
            'goldResult', e.gold_result::float, 'silverResult', e.silver_result::float,
            'chemistName', u.full_name) AS entry
        FROM batch b JOIN bullion_intake_items i ON i.batch_id = b.id
        LEFT JOIN LATERAL (SELECT * FROM bullion_examination_revisions WHERE bullion_item_id = i.id ORDER BY revision_no DESC LIMIT 1) e ON true
        LEFT JOIN users u ON u.id = e.entered_by_user_id
      ), issued AS (
        INSERT INTO bullion_certificates (batch_id, assay_center_id, issue_year, sequence_no, entries)
        SELECT b.id, b.assay_center_id, b.issue_year,
          COALESCE((SELECT max(sequence_no) FROM bullion_certificates WHERE assay_center_id = b.assay_center_id AND issue_year = b.issue_year), 0) + 1,
          (SELECT jsonb_agg(entry ORDER BY sequence_no) FROM results)
        FROM batch b WHERE NOT EXISTS (SELECT 1 FROM existing)
          AND (SELECT count(*) FROM results) = b.piece_count
          AND NOT EXISTS (SELECT 1 FROM results WHERE ready IS NOT TRUE)
        RETURNING *
      ), audit AS (
        INSERT INTO audit_logs (actor_user_id, actor_organization_id, action, entity_type, entity_id, new_values, reason, previous_hash, entry_hash)
        SELECT ${user.id}::uuid, ${user.organizationId}::uuid, 'bullion_certificate.created', 'bullion_certificates', id,
          to_jsonb(issued), 'Complete request certificate',
          (SELECT entry_hash FROM audit_logs ORDER BY created_at DESC LIMIT 1), ${hash} FROM issued
      ) SELECT issue_year AS "issueYear", sequence_no AS "sequenceNo", issued_at::text AS "issuedAt", entries FROM issued
        UNION ALL SELECT issue_year AS "issueYear", sequence_no AS "sequenceNo", issued_at::text AS "issuedAt", entries FROM existing
    `),
  ]);
  const certificate = rows(result[1])[0];
  return certificate ? { ...certificate, certificateNo: String(certificate.sequenceNo).padStart(4, "0") } : null;
}
