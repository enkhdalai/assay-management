ALTER TABLE "bullion_intake_batches"
  ADD COLUMN IF NOT EXISTS "act_number" varchar(80),
  ADD COLUMN IF NOT EXISTS "act_date" date;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bullion_intake_batches_center_act_number_uidx"
  ON "bullion_intake_batches" USING btree ("assay_center_id", "act_number")
  WHERE "act_number" IS NOT NULL;
