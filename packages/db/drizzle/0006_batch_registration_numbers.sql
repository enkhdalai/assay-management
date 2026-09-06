DROP INDEX "bullion_intake_batches_public_id_uidx";--> statement-breakpoint
WITH numbered AS (
  SELECT b.id,
    COALESCE(o.metadata->>'bullionPrefix', CASE WHEN o.type = 'private_assay_center' THEN '55' ELSE '' END) AS prefix,
    row_number() OVER (PARTITION BY b.assay_center_id ORDER BY b.created_at, b.id) AS sequence_no
  FROM bullion_intake_batches b
  JOIN organizations o ON o.id = b.assay_center_id
)
UPDATE bullion_intake_batches b
SET public_id = numbered.prefix || lpad(numbered.sequence_no::text, 4, '0')
FROM numbered WHERE b.id = numbered.id;--> statement-breakpoint
CREATE UNIQUE INDEX "bullion_intake_batches_center_public_id_uidx" ON "bullion_intake_batches" USING btree ("assay_center_id","public_id");
