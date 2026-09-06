CREATE SCHEMA IF NOT EXISTS "integration";--> statement-breakpoint
CREATE TABLE "integration"."bom_certificate_publications" (
  "certificate_id" uuid PRIMARY KEY REFERENCES "public"."bullion_certificates"("id") ON DELETE restrict,
  "batch_id" uuid NOT NULL REFERENCES "public"."bullion_intake_batches"("id") ON DELETE restrict,
  "assay_center_id" uuid NOT NULL REFERENCES "public"."organizations"("id") ON DELETE restrict,
  "certificate_no" varchar(80) NOT NULL,
  "approved_at" timestamp with time zone NOT NULL,
  "payload" jsonb NOT NULL,
  "payload_hash" varchar(128) NOT NULL,
  "status" varchar(24) NOT NULL DEFAULT 'active',
  "published_at" timestamp with time zone NOT NULL DEFAULT now(),
  "superseded_at" timestamp with time zone
);--> statement-breakpoint
CREATE INDEX "bom_certificate_publications_center_approved_idx" ON "integration"."bom_certificate_publications" ("assay_center_id", "approved_at" DESC);--> statement-breakpoint
CREATE INDEX "bom_certificate_publications_status_approved_idx" ON "integration"."bom_certificate_publications" ("status", "approved_at" DESC);--> statement-breakpoint
CREATE TABLE "integration"."bank_certificate_access" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "certificate_id" uuid NOT NULL REFERENCES "integration"."bom_certificate_publications"("certificate_id") ON DELETE restrict,
  "bank_organization_id" uuid NOT NULL REFERENCES "public"."organizations"("id") ON DELETE restrict,
  "bullion_item_id" uuid REFERENCES "public"."bullion_intake_items"("id") ON DELETE restrict,
  "status" varchar(24) NOT NULL DEFAULT 'pending',
  "visible_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX "bank_certificate_access_certificate_bank_batch_uidx" ON "integration"."bank_certificate_access" ("certificate_id", "bank_organization_id") WHERE "bullion_item_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_certificate_access_certificate_bank_item_uidx" ON "integration"."bank_certificate_access" ("certificate_id", "bank_organization_id", "bullion_item_id") WHERE "bullion_item_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "bank_certificate_access_bank_status_idx" ON "integration"."bank_certificate_access" ("bank_organization_id", "status", "visible_at" DESC);
