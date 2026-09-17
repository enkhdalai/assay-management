ALTER TABLE "bullion_examination_revisions" ADD COLUMN "silver_method" varchar(32);--> statement-breakpoint
ALTER TABLE "bullion_examination_revisions" ADD COLUMN "silver_titer_mg_per_ml" numeric(14, 6);--> statement-breakpoint
ALTER TABLE "bullion_examination_revisions" ADD COLUMN "silver_blank_volume_ml" numeric(14, 6);
