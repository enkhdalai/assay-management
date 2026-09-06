CREATE TABLE "bullion_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"assay_center_id" uuid NOT NULL,
	"prefix" varchar(2) NOT NULL,
	"sequence_no" integer NOT NULL,
	"entries" jsonb NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bullion_certificates_sequence_positive" CHECK ("bullion_certificates"."sequence_no" > 0),
	CONSTRAINT "bullion_certificates_prefix_valid" CHECK ("bullion_certificates"."prefix" IN ('', '55', '22', '27'))
);
--> statement-breakpoint
ALTER TABLE "bullion_certificates" ADD CONSTRAINT "bullion_certificates_batch_id_bullion_intake_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."bullion_intake_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bullion_certificates" ADD CONSTRAINT "bullion_certificates_assay_center_id_organizations_id_fk" FOREIGN KEY ("assay_center_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bullion_certificates_batch_uidx" ON "bullion_certificates" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bullion_certificates_center_sequence_uidx" ON "bullion_certificates" USING btree ("assay_center_id","sequence_no");