CREATE TABLE IF NOT EXISTS "service_price_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "service_code" varchar(64) NOT NULL,
  "metal_scope" varchar(32) NOT NULL,
  "min_weight_grams" numeric(14, 3),
  "max_weight_grams" numeric(14, 3),
  "price_mnt" numeric(18, 2) NOT NULL,
  "effective_from" date NOT NULL,
  "effective_to" date,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "service_price_rules_price_positive" CHECK ("service_price_rules"."price_mnt" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_price_rules_lookup_idx" ON "service_price_rules" USING btree ("service_code", "metal_scope", "effective_from");
--> statement-breakpoint
ALTER TABLE "jewelry_intake_records" ADD COLUMN IF NOT EXISTS "total_weight_grams" numeric(14, 3) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "jewelry_intake_records" ADD COLUMN IF NOT EXISTS "calculated_service_price_mnt" numeric(18, 2) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "jewelry_intake_records" ADD COLUMN IF NOT EXISTS "marking_service" varchar(16) NOT NULL DEFAULT 'none';
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jewelry_intake_records_total_weight_positive') THEN
    ALTER TABLE "jewelry_intake_records" ADD CONSTRAINT "jewelry_intake_records_total_weight_positive" CHECK ("jewelry_intake_records"."total_weight_grams" >= 0);
  END IF;
END $$;
--> statement-breakpoint
WITH seed ("service_code", "metal_scope", "min_weight_grams", "max_weight_grams", "price_mnt", "effective_from") AS (VALUES
  ('gold_jewelry_analysis', 'gold', 0, 500, 50000, '2026-01-01'::date),
  ('gold_jewelry_analysis', 'gold', 500.001, 2000, 100000, '2026-01-01'),
  ('gold_jewelry_analysis', 'gold', 2000.001, 4000, 150000, '2026-01-01'),
  ('gold_jewelry_analysis', 'gold', 4000.001, 6000, 175000, '2026-01-01'),
  ('gold_jewelry_analysis', 'gold', 6000.001, NULL, 250000, '2026-01-01'),
  ('silver_bullion_analysis', 'silver', 0, 2000, 25000, '2026-01-01'),
  ('silver_bullion_analysis', 'silver', 2000.001, 4000, 50000, '2026-01-01'),
  ('silver_bullion_analysis', 'silver', 4000.001, 6000, 75000, '2026-01-01'),
  ('silver_bullion_analysis', 'silver', 6000.001, NULL, 100000, '2026-01-01'),
  ('silver_jewelry_analysis', 'silver', NULL, NULL, 25000, '2026-01-01'),
  ('platinum_group_analysis', 'platinum', NULL, NULL, 80000, '2026-01-01'),
  ('gold_comparison_sample', 'gold', NULL, NULL, 5000, '2026-01-01'),
  ('silver_comparison_sample', 'silver', NULL, NULL, 5000, '2026-01-01'),
  ('platinum_comparison_sample', 'platinum', NULL, NULL, 5000, '2026-01-01'),
  ('spectral_xrf_jewelry_analysis', 'all', NULL, NULL, 35000, '2026-01-01'),
  ('gold_hallmark', 'gold', NULL, NULL, 2000, '2026-01-01'),
  ('silver_hallmark', 'silver', NULL, NULL, 1000, '2026-01-01'),
  ('platinum_hallmark', 'platinum', NULL, NULL, 5000, '2026-01-01'),
  ('gold_laser', 'gold', NULL, NULL, 4000, '2026-01-01'),
  ('silver_laser', 'silver', NULL, NULL, 2000, '2026-01-01'),
  ('platinum_laser', 'platinum', NULL, NULL, 10000, '2026-01-01')
)
INSERT INTO "service_price_rules" ("service_code", "metal_scope", "min_weight_grams", "max_weight_grams", "price_mnt", "effective_from")
SELECT seed.* FROM seed
WHERE NOT EXISTS (
  SELECT 1 FROM "service_price_rules" existing
  WHERE existing."service_code" = seed."service_code"
    AND existing."metal_scope" = seed."metal_scope"
    AND existing."min_weight_grams" IS NOT DISTINCT FROM seed."min_weight_grams"
    AND existing."max_weight_grams" IS NOT DISTINCT FROM seed."max_weight_grams"
    AND existing."effective_from" = seed."effective_from"
);
