CREATE TABLE "chemist_daily_availability" (
  "organization_id" uuid NOT NULL,
  "chemist_id" uuid NOT NULL,
  "assignment_date" date NOT NULL,
  "is_on_vacation" boolean DEFAULT false NOT NULL,
  "updated_by_user_id" uuid,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chemist_daily_availability_pk" PRIMARY KEY("organization_id", "chemist_id", "assignment_date")
);
--> statement-breakpoint
CREATE TABLE "bullion_daily_chemist_assignments" (
  "organization_id" uuid NOT NULL,
  "assignment_date" date NOT NULL,
  "metal" "metal_type" NOT NULL,
  "chemist_id" uuid NOT NULL,
  "updated_by_user_id" uuid,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "bullion_daily_chemist_assignments_pk" PRIMARY KEY("organization_id", "assignment_date", "metal")
);
--> statement-breakpoint
ALTER TABLE "chemist_daily_availability" ADD CONSTRAINT "chemist_daily_availability_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "chemist_daily_availability" ADD CONSTRAINT "chemist_daily_availability_chemist_id_users_id_fk" FOREIGN KEY ("chemist_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "chemist_daily_availability" ADD CONSTRAINT "chemist_daily_availability_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bullion_daily_chemist_assignments" ADD CONSTRAINT "bullion_daily_chemist_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bullion_daily_chemist_assignments" ADD CONSTRAINT "bullion_daily_chemist_assignments_chemist_id_users_id_fk" FOREIGN KEY ("chemist_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bullion_daily_chemist_assignments" ADD CONSTRAINT "bullion_daily_chemist_assignments_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "chemist_daily_availability_date_idx" ON "chemist_daily_availability" USING btree ("organization_id", "assignment_date");
