ALTER TABLE "customers" ADD COLUMN "assay_center_id" uuid;--> statement-breakpoint
UPDATE "customers" AS customer
SET "assay_center_id" = creator."organization_id"
FROM "users" AS creator
WHERE creator."id" = customer."created_by_user_id";--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "assay_center_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_assay_center_id_organizations_id_fk" FOREIGN KEY ("assay_center_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customers_assay_center_idx" ON "customers" USING btree ("assay_center_id");
