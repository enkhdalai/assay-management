import { sql } from "drizzle-orm";

import type { AppDatabase } from "../../../../packages/db/src";
import { publishBomCertificateIfReady } from "../bom/publications";

/**
 * Boundary used by the MonPass/Tridum adapter after it has verified the
 * provider's signed callback. Private keys and PINs never enter this service.
 */
export type VerifiedCertificateSignature = {
  certificateId: string;
  provider: "monpass" | "tridum";
  providerTransactionId: string;
  signatureValue: string;
  signerCertificate: string;
  certificateChain: unknown;
  signatureAlgorithm: string;
  signedAt: string;
  validationEvidence: unknown;
};

export async function recordVerifiedCertificateSignature(
  db: AppDatabase,
  signature: VerifiedCertificateSignature,
): Promise<boolean> {
  const result = await db.execute<{ bullionItemId: string }>(sql`
    WITH signed AS (
      UPDATE bullion_certificates
      SET signature_status = 'signed', signature_provider = ${signature.provider},
        provider_transaction_id = ${signature.providerTransactionId}, signature_value = ${signature.signatureValue},
        signer_certificate = ${signature.signerCertificate}, certificate_chain = ${JSON.stringify(signature.certificateChain)}::jsonb,
        signature_algorithm = ${signature.signatureAlgorithm}, signed_at = ${signature.signedAt}::timestamptz,
        validation_evidence = ${JSON.stringify(signature.validationEvidence)}::jsonb
      WHERE id = ${signature.certificateId}::uuid AND signature_status IN ('unsigned', 'signing')
        AND document_hash IS NOT NULL AND manifest IS NOT NULL
      RETURNING batch_id
    )
    SELECT item.id AS "bullionItemId" FROM signed
    JOIN bullion_intake_items item ON item.batch_id = signed.batch_id
    ORDER BY item.sequence_no LIMIT 1
  `);
  const [row] = Array.isArray(result) ? result : result.rows;
  if (!row) return false;
  await publishBomCertificateIfReady(db, row.bullionItemId);
  return true;
}
