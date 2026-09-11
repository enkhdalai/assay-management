ALTER TABLE "bullion_certificates"
  ADD COLUMN "manifest" jsonb,
  ADD COLUMN "document_hash" varchar(64),
  ADD COLUMN "verification_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  ADD COLUMN "signature_status" varchar(24) DEFAULT 'unsigned' NOT NULL,
  ADD COLUMN "signature_provider" varchar(48),
  ADD COLUMN "provider_transaction_id" varchar(255),
  ADD COLUMN "signature_value" text,
  ADD COLUMN "signer_certificate" text,
  ADD COLUMN "certificate_chain" jsonb,
  ADD COLUMN "signature_algorithm" varchar(96),
  ADD COLUMN "signed_at" timestamp with time zone,
  ADD COLUMN "validation_evidence" jsonb,
  ADD COLUMN "voided_at" timestamp with time zone,
  ADD COLUMN "void_reason" varchar(500);
--> statement-breakpoint
ALTER TABLE "bullion_certificates" ADD CONSTRAINT "bullion_certificates_signature_status_valid"
  CHECK ("signature_status" IN ('unsigned', 'signing', 'signed', 'failed', 'voided', 'superseded'));
--> statement-breakpoint
ALTER TABLE "bullion_certificates" ADD CONSTRAINT "bullion_certificates_document_hash_valid"
  CHECK ("document_hash" IS NULL OR "document_hash" ~ '^[0-9a-f]{64}$');
--> statement-breakpoint
CREATE UNIQUE INDEX "bullion_certificates_verification_uidx" ON "bullion_certificates" USING btree ("verification_id");
