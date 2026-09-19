ALTER TABLE "bullion_intake_batches"
  ADD COLUMN IF NOT EXISTS "split_from_batch_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bullion_intake_batches_split_from_batch_id_fk') THEN
    ALTER TABLE "bullion_intake_batches"
      ADD CONSTRAINT "bullion_intake_batches_split_from_batch_id_fk"
      FOREIGN KEY ("split_from_batch_id") REFERENCES "public"."bullion_intake_batches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bullion_intake_batches_split_from_idx"
  ON "bullion_intake_batches" USING btree ("split_from_batch_id");
