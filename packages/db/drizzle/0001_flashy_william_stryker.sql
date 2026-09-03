CREATE TABLE "bullion_examination_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bullion_item_id" uuid NOT NULL,
	"revision_no" integer NOT NULL,
	"examination_no" varchar(80) NOT NULL,
	"entered_by_user_id" uuid NOT NULL,
	"status" "assay_result_status" DEFAULT 'draft' NOT NULL,
	"delta" numeric(14, 6) DEFAULT '0' NOT NULL,
	"sample_weight_grams" numeric(14, 4) NOT NULL,
	"weight_entries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"measurement_entries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gold_result" numeric(12, 6),
	"silver_result" numeric(12, 6),
	"reexamination_requested" boolean DEFAULT false NOT NULL,
	"notes" text,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bullion_examinations_revision_positive" CHECK ("bullion_examination_revisions"."revision_no" > 0),
	CONSTRAINT "bullion_examinations_sample_weight_positive" CHECK ("bullion_examination_revisions"."sample_weight_grams" > 0)
);
--> statement-breakpoint
CREATE TABLE "bullion_intake_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" varchar(40) NOT NULL,
	"assay_center_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"received_by_user_id" uuid NOT NULL,
	"metal" "metal_type" NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"branch_name" varchar(255),
	"province" varchar(120),
	"district" varchar(120),
	"dispatch_reference" varchar(120),
	"initial_bullion_number" varchar(80),
	"piece_count" integer NOT NULL,
	"delta" numeric(14, 6) DEFAULT '0' NOT NULL,
	"status" varchar(32) DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bullion_intake_batches_piece_count_positive" CHECK ("bullion_intake_batches"."piece_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "bullion_intake_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"sequence_no" integer NOT NULL,
	"analysis_no" varchar(80),
	"bullion_no" varchar(80) NOT NULL,
	"gross_weight_before_grams" numeric(14, 4) NOT NULL,
	"gross_weight_after_grams" numeric(14, 4),
	"slag_weight_grams" numeric(14, 4),
	"sample_weight_milligrams" numeric(14, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bullion_intake_items_weight_positive" CHECK ("bullion_intake_items"."gross_weight_before_grams" > 0)
);
--> statement-breakpoint
CREATE TABLE "customer_organization_profiles" (
	"customer_id" uuid PRIMARY KEY NOT NULL,
	"deposit_name" varchar(255),
	"branch_name" varchar(255),
	"organization_kind" varchar(120),
	"bank_name" varchar(255),
	"bank_account_encrypted" text,
	"province" varchar(120),
	"district" varchar(120),
	"bag" varchar(120),
	"mine_initial_number" varchar(80),
	"contact_name" varchar(255),
	"contact_phone_encrypted" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bullion_examination_revisions" ADD CONSTRAINT "bullion_examination_revisions_bullion_item_id_bullion_intake_items_id_fk" FOREIGN KEY ("bullion_item_id") REFERENCES "public"."bullion_intake_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bullion_examination_revisions" ADD CONSTRAINT "bullion_examination_revisions_entered_by_user_id_users_id_fk" FOREIGN KEY ("entered_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bullion_intake_batches" ADD CONSTRAINT "bullion_intake_batches_assay_center_id_organizations_id_fk" FOREIGN KEY ("assay_center_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bullion_intake_batches" ADD CONSTRAINT "bullion_intake_batches_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bullion_intake_batches" ADD CONSTRAINT "bullion_intake_batches_received_by_user_id_users_id_fk" FOREIGN KEY ("received_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bullion_intake_items" ADD CONSTRAINT "bullion_intake_items_batch_id_bullion_intake_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."bullion_intake_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_organization_profiles" ADD CONSTRAINT "customer_organization_profiles_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bullion_examinations_item_revision_uidx" ON "bullion_examination_revisions" USING btree ("bullion_item_id","revision_no");--> statement-breakpoint
CREATE INDEX "bullion_examinations_status_idx" ON "bullion_examination_revisions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "bullion_intake_batches_public_id_uidx" ON "bullion_intake_batches" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "bullion_intake_batches_customer_received_idx" ON "bullion_intake_batches" USING btree ("customer_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bullion_intake_items_batch_sequence_uidx" ON "bullion_intake_items" USING btree ("batch_id","sequence_no");--> statement-breakpoint
CREATE INDEX "bullion_intake_items_bullion_no_idx" ON "bullion_intake_items" USING btree ("bullion_no");--> statement-breakpoint
CREATE INDEX "customer_org_profiles_deposit_idx" ON "customer_organization_profiles" USING btree ("deposit_name");