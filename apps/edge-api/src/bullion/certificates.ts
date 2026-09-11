import { sql } from "drizzle-orm";
import type { AppDatabase } from "../../../../packages/db/src";
import { decryptField, isValidFieldEncryptionKey, sha256Base64Url, sha256Hex, type AuthenticatedUser } from "../../../../packages/security/src";
import { canonicalizeJson, type CanonicalJson } from "../../../../packages/shared/src";
import type { CertificateEntry } from "../../../../packages/shared/src/bullion-types";

type Certificate = {
  id: string; issueYear: number; sequenceNo: number; issuedAt: string; entries: CertificateEntry[] | string;
  documentHash: string | null; verificationId: string; signatureStatus: string;
};
type CertificateSource = Certificate & {
  batchId: string; publicId: string; metal: string; receivedAt: string; branchName: string | null;
  province: string | null; district: string | null; dispatchReference: string | null; delta: string;
  assayCenterId: string; assayCenterName: string; assayCenterCode: string | null;
  customerName: string; customerType: string; registrationNumberEncrypted: string | null;
};
const rows = <T,>(result: T[] | { rows: T[] }) => Array.isArray(result) ? result : result.rows;
const json = <T,>(value: T | string): T => typeof value === "string" ? JSON.parse(value) as T : value;

async function revealRegistrationNumber(value: string | null, encryptionKey?: string): Promise<string | null> {
  if (!value) return null;
  if (!value.startsWith("v1.")) return value;
  if (!isValidFieldEncryptionKey(encryptionKey)) return null;
  try { return await decryptField(value, encryptionKey); } catch { return null; }
}

function buildManifest(source: CertificateSource, user: AuthenticatedUser, registrationNo: string | null): CanonicalJson {
  const bullions = json<CertificateEntry[]>(source.entries).map((entry) => ({
    analysisNo: String(entry.analysisNo), bullionNo: entry.bullionNo, bullionWeightGrams: String(entry.bullionWeightGrams),
    origin: entry.origin, sampleWeightMilligrams: String(entry.sampleWeightMilligrams),
    remainingMilligrams: String(entry.remainingMilligrams), lossMilligrams: String(entry.lossMilligrams),
    returnedMilligrams: String(entry.returnedMilligrams), goldFinenessPermille: String(entry.goldResult),
    silverFinenessPermille: String(entry.silverResult), chemistName: entry.chemistName,
  }));
  return {
    schema: "assay-center.bullion-certificate/v1",
    certificate: { id: source.id, verificationId: source.verificationId, issueYear: source.issueYear,
      number: String(source.sequenceNo).padStart(4, "0"), issuedAt: source.issuedAt },
    assayCenter: { id: source.assayCenterId, name: source.assayCenterName, code: source.assayCenterCode },
    customer: { name: source.customerName, type: source.customerType, registrationNo },
    intake: { batchId: source.batchId, registrationNo: source.publicId, metal: source.metal, receivedAt: source.receivedAt,
      branchName: source.branchName, province: source.province, district: source.district, origin: source.dispatchReference, delta: source.delta },
    bullions,
    approvedBy: { userId: user.id, name: user.fullName, role: user.role },
  };
}

export async function issueCertificate(db: AppDatabase, user: AuthenticatedUser, batchId: string, encryptionKey?: string) {
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
          to_jsonb(issued), 'Certificate prepared for digital signature',
          (SELECT entry_hash FROM audit_logs ORDER BY created_at DESC LIMIT 1), ${hash} FROM issued
      ) SELECT id, issue_year AS "issueYear", sequence_no AS "sequenceNo", issued_at::text AS "issuedAt", entries,
          document_hash AS "documentHash", verification_id AS "verificationId", signature_status AS "signatureStatus" FROM issued
        UNION ALL SELECT id, issue_year AS "issueYear", sequence_no AS "sequenceNo", issued_at::text AS "issuedAt", entries,
          document_hash AS "documentHash", verification_id AS "verificationId", signature_status AS "signatureStatus" FROM existing
    `),
  ]);
  const certificate = rows(result[1])[0];
  if (!certificate) return null;
  const [source] = rows(await db.execute<CertificateSource>(sql`
    SELECT certificate.id, certificate.issue_year AS "issueYear", certificate.sequence_no AS "sequenceNo", certificate.issued_at::text AS "issuedAt",
      certificate.entries, certificate.document_hash AS "documentHash", certificate.verification_id AS "verificationId", certificate.signature_status AS "signatureStatus",
      batch.id AS "batchId", batch.public_id AS "publicId", batch.metal, batch.received_at::text AS "receivedAt", batch.branch_name AS "branchName",
      batch.province, batch.district, batch.dispatch_reference AS "dispatchReference", batch.delta::text AS delta,
      center.id AS "assayCenterId", center.name AS "assayCenterName", center.code AS "assayCenterCode",
      customer.display_name AS "customerName", customer.type AS "customerType", customer.registration_number_encrypted AS "registrationNumberEncrypted"
    FROM bullion_certificates certificate
    JOIN bullion_intake_batches batch ON batch.id = certificate.batch_id
    JOIN organizations center ON center.id = certificate.assay_center_id
    JOIN customers customer ON customer.id = batch.customer_id
    WHERE certificate.id = ${certificate.id}::uuid
  `));
  if (!source) return null;
  let documentHash = source.documentHash;
  if (!documentHash) {
    const manifest = buildManifest(source, user, await revealRegistrationNumber(source.registrationNumberEncrypted, encryptionKey));
    documentHash = await sha256Hex(canonicalizeJson(manifest));
    await db.execute(sql`
      UPDATE bullion_certificates SET manifest = ${JSON.stringify(manifest)}::jsonb, document_hash = ${documentHash}
      WHERE id = ${source.id}::uuid AND document_hash IS NULL
    `);
  }
  return { ...certificate, entries: json<CertificateEntry[]>(certificate.entries), documentHash,
    signatureStatus: source.signatureStatus, verificationId: source.verificationId,
    certificateNo: String(certificate.sequenceNo).padStart(4, "0") };
}
