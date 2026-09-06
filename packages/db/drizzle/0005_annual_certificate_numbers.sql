ALTER TABLE "bullion_certificates" DROP CONSTRAINT "bullion_certificates_prefix_valid";--> statement-breakpoint
DROP INDEX "bullion_certificates_center_sequence_uidx";--> statement-breakpoint
ALTER TABLE "bullion_certificates" ADD COLUMN "issue_year" integer DEFAULT EXTRACT(YEAR FROM CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ulaanbaatar')::integer NOT NULL;--> statement-breakpoint
UPDATE "bullion_certificates" SET "issue_year" = EXTRACT(YEAR FROM "issued_at" AT TIME ZONE 'Asia/Ulaanbaatar')::integer;--> statement-breakpoint
CREATE UNIQUE INDEX "bullion_certificates_center_year_sequence_uidx" ON "bullion_certificates" USING btree ("assay_center_id","issue_year","sequence_no");--> statement-breakpoint
ALTER TABLE "bullion_certificates" DROP COLUMN "prefix";--> statement-breakpoint
UPDATE organizations SET metadata = (metadata - 'certificatePrefix') || jsonb_build_object('bullionPrefix', metadata->'certificatePrefix')
WHERE metadata ? 'certificatePrefix' AND NOT metadata ? 'bullionPrefix';
