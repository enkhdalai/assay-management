ALTER TABLE "bullion_daily_chemist_assignments" DROP CONSTRAINT "bullion_daily_chemist_assignments_pk";
--> statement-breakpoint
ALTER TABLE "bullion_daily_chemist_assignments" ADD CONSTRAINT "bullion_daily_chemist_assignments_pk" PRIMARY KEY("organization_id", "assignment_date", "metal", "chemist_id");
