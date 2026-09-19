CREATE TABLE "jewelry_item_catalogue" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "item_name" varchar(255) NOT NULL,
  "metal" "metal_type" NOT NULL,
  "spoon_type" varchar(32) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "jewelry_item_catalogue_item_name_uidx" ON "jewelry_item_catalogue" USING btree ("item_name");
--> statement-breakpoint
INSERT INTO "jewelry_item_catalogue" ("item_name", "metal", "spoon_type") VALUES
  ('Таг/мөнгөн/', 'silver', 'Халбагатай'),
  ('Зүрх /алтан/', 'gold', 'Халбагагүй'),
  ('Хяналтын дээж/999,99/', 'gold', 'Халбагагүй'),
  ('Цагны нүүр/алтан/', 'gold', 'Халбагатай'),
  ('Бүсний тоног/алтан/', 'gold', 'Халбагатай'),
  ('Цөгц/алтан/', 'gold', 'Халбагатай'),
  ('Дөрөө/мөнгөн/', 'silver', 'Халбагатай'),
  ('Ялтсан зоос/алтан/', 'gold', 'Халбагагүй'),
  ('Одон/мөнгөн/', 'silver', 'Халбагатай'),
  ('Сэрээ /алтан/', 'gold', 'Халбагатай'),
  ('Халбага /алтан/', 'gold', 'Халбагатай'),
  ('Тогоо /алтан/ сүвнер', 'gold', 'Халбагатай'),
  ('Тулга /алтан/ сүвнер', 'gold', 'Халбагатай'),
  ('Хуудас /алтан/', 'gold', 'Халбагагүй'),
  ('Өлзий/алтан/', 'gold', 'Халбагагүй'),
  ('Чарм/алтан/', 'gold', 'Халбагагүй'),
  ('Эрх/алтан/', 'gold', 'Халбагагүй'),
  ('Очир/алтан/', 'gold', 'Халбагагүй'),
  ('Шатрын чимэг/алтан/', 'gold', 'Халбагатай'),
  ('Хяналтын дээж/алтан/', 'gold', 'Халбагатай');
--> statement-breakpoint
CREATE TABLE "jewelry_intake_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "assay_center_id" uuid NOT NULL,
  "customer_id" uuid NOT NULL,
  "received_by_user_id" uuid NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "item_name" varchar(255) NOT NULL,
  "metal" "metal_type" NOT NULL,
  "spoon_type" varchar(32) NOT NULL,
  "quality_kind" varchar(16) NOT NULL,
  "quality_value" numeric(14, 6) NOT NULL,
  "weight_band" varchar(32) NOT NULL,
  "piece_count" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "jewelry_intake_records_piece_count_positive" CHECK ("jewelry_intake_records"."piece_count" > 0)
);
--> statement-breakpoint
ALTER TABLE "jewelry_intake_records" ADD CONSTRAINT "jewelry_intake_records_assay_center_id_organizations_id_fk" FOREIGN KEY ("assay_center_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "jewelry_intake_records" ADD CONSTRAINT "jewelry_intake_records_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "jewelry_intake_records" ADD CONSTRAINT "jewelry_intake_records_received_by_user_id_users_id_fk" FOREIGN KEY ("received_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "jewelry_intake_records_center_received_idx" ON "jewelry_intake_records" USING btree ("assay_center_id", "received_at");
--> statement-breakpoint
CREATE INDEX "jewelry_intake_records_customer_received_idx" ON "jewelry_intake_records" USING btree ("customer_id", "received_at");
