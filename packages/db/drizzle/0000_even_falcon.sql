CREATE TYPE "public"."allocation_status" AS ENUM('draft', 'assigned', 'visible_to_bank', 'accepted_by_bank', 'settlement_pending', 'settled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."api_client_status" AS ENUM('active', 'rotating', 'suspended', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."api_request_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."assay_result_status" AS ENUM('draft', 'submitted', 'approved', 'superseded', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."assay_status" AS ENUM('draft', 'received', 'in_analysis', 'manager_review', 'approved', 'bom_submitted', 'bom_confirmed', 'bank_assigned', 'settlement_pending', 'settled', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."bom_confirmation_status" AS ENUM('pending', 'confirmed', 'rejected', 'corrected', 'voided');--> statement-breakpoint
CREATE TYPE "public"."bom_submission_status" AS ENUM('queued', 'sent', 'accepted', 'rejected', 'failed');--> statement-breakpoint
CREATE TYPE "public"."certificate_status" AS ENUM('draft', 'issued', 'voided');--> statement-breakpoint
CREATE TYPE "public"."correction_status" AS ENUM('requested', 'approved', 'rejected', 'applied', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."customer_type" AS ENUM('individual', 'legal_entity');--> statement-breakpoint
CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."login_event_outcome" AS ENUM('success', 'failed', 'locked', 'mfa_required', 'mfa_failed');--> statement-breakpoint
CREATE TYPE "public"."metal_type" AS ENUM('gold', 'silver');--> statement-breakpoint
CREATE TYPE "public"."organization_status" AS ENUM('active', 'suspended', 'archived');--> statement-breakpoint
CREATE TYPE "public"."organization_type" AS ENUM('private_assay_center', 'government_assay_center', 'bank_of_mongolia', 'commercial_bank', 'system_operator');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('active', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('system_admin', 'assay_admin', 'intake_officer', 'chemist', 'lab_manager', 'bom_officer', 'commercial_bank_user', 'auditor');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('invited', 'active', 'locked', 'disabled');--> statement-breakpoint
CREATE TABLE "api_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"client_id" varchar(120) NOT NULL,
	"secret_hash" text NOT NULL,
	"status" "api_client_status" DEFAULT 'active' NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"allowed_ip_cidrs" text[] DEFAULT '{}' NOT NULL,
	"require_hmac" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_request_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_client_id" uuid,
	"direction" "api_request_direction" NOT NULL,
	"request_id" varchar(128) NOT NULL,
	"idempotency_key" varchar(128),
	"method" varchar(12) NOT NULL,
	"path" text NOT NULL,
	"status_code" integer,
	"request_hash" varchar(128),
	"response_hash" varchar(128),
	"ip_hash" varchar(128),
	"user_agent" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assay_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assay_record_id" uuid NOT NULL,
	"result_revision_id" uuid NOT NULL,
	"certificate_no" varchar(80) NOT NULL,
	"status" "certificate_status" DEFAULT 'draft' NOT NULL,
	"issued_by_user_id" uuid,
	"document_hash" varchar(128),
	"issued_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assay_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" varchar(32) NOT NULL,
	"assay_center_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"intake_officer_id" uuid NOT NULL,
	"metal" "metal_type" NOT NULL,
	"declared_gross_weight_grams" numeric(14, 4) NOT NULL,
	"received_gross_weight_grams" numeric(14, 4) NOT NULL,
	"status" "assay_status" DEFAULT 'draft' NOT NULL,
	"customer_instruction" text,
	"received_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"locked_by_user_id" uuid,
	"lock_reason" text,
	"current_result_revision" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assay_records_declared_weight_positive" CHECK ("assay_records"."declared_gross_weight_grams" > 0),
	CONSTRAINT "assay_records_received_weight_positive" CHECK ("assay_records"."received_gross_weight_grams" > 0)
);
--> statement-breakpoint
CREATE TABLE "assay_result_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assay_record_id" uuid NOT NULL,
	"revision_no" integer NOT NULL,
	"status" "assay_result_status" DEFAULT 'draft' NOT NULL,
	"entered_by_user_id" uuid NOT NULL,
	"approved_by_user_id" uuid,
	"method_name" varchar(120) NOT NULL,
	"instrument_name" varchar(120),
	"gross_weight_grams" numeric(14, 4) NOT NULL,
	"purity_percent" numeric(7, 4) NOT NULL,
	"fine_weight_grams" numeric(14, 4) NOT NULL,
	"silver_content_percent" numeric(7, 4),
	"gold_content_percent" numeric(7, 4),
	"result_notes" text,
	"correction_reason" text,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assay_result_revisions_revision_positive" CHECK ("assay_result_revisions"."revision_no" > 0),
	CONSTRAINT "assay_result_revisions_gross_weight_positive" CHECK ("assay_result_revisions"."gross_weight_grams" > 0),
	CONSTRAINT "assay_result_revisions_purity_range" CHECK ("assay_result_revisions"."purity_percent" >= 0 AND "assay_result_revisions"."purity_percent" <= 100),
	CONSTRAINT "assay_result_revisions_fine_weight_nonnegative" CHECK ("assay_result_revisions"."fine_weight_grams" >= 0),
	CONSTRAINT "assay_result_revisions_maker_checker" CHECK ("assay_result_revisions"."approved_by_user_id" IS NULL OR "assay_result_revisions"."approved_by_user_id" <> "assay_result_revisions"."entered_by_user_id")
);
--> statement-breakpoint
CREATE TABLE "assay_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assay_record_id" uuid NOT NULL,
	"sample_no" integer NOT NULL,
	"seal_number" varchar(80),
	"container_label" varchar(120),
	"sample_weight_grams" numeric(14, 4) NOT NULL,
	"received_by_user_id" uuid,
	"lab_received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assay_samples_sample_no_positive" CHECK ("assay_samples"."sample_no" > 0),
	CONSTRAINT "assay_samples_weight_positive" CHECK ("assay_samples"."sample_weight_grams" > 0)
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"actor_organization_id" uuid,
	"action" varchar(120) NOT NULL,
	"entity_type" varchar(80) NOT NULL,
	"entity_id" uuid,
	"old_values" jsonb,
	"new_values" jsonb,
	"reason" text,
	"request_id" varchar(128),
	"ip_hash" varchar(128),
	"user_agent" text,
	"previous_hash" varchar(128),
	"entry_hash" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assay_record_id" uuid NOT NULL,
	"bank_organization_id" uuid NOT NULL,
	"allocated_gross_weight_grams" numeric(14, 4) NOT NULL,
	"customer_instruction_note" text,
	"status" "allocation_status" DEFAULT 'draft' NOT NULL,
	"visible_to_bank_at" timestamp with time zone,
	"accepted_by_bank_user_id" uuid,
	"accepted_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_allocations_weight_positive" CHECK ("bank_allocations"."allocated_gross_weight_grams" > 0)
);
--> statement-breakpoint
CREATE TABLE "bank_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_allocation_id" uuid NOT NULL,
	"bom_confirmation_allocation_id" uuid NOT NULL,
	"bank_user_id" uuid,
	"settlement_reference" varchar(120),
	"payable_amount_mnt" numeric(18, 2),
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_settlements_payable_nonnegative" CHECK ("bank_settlements"."payable_amount_mnt" IS NULL OR "bank_settlements"."payable_amount_mnt" >= 0)
);
--> statement-breakpoint
CREATE TABLE "bom_confirmation_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bom_confirmation_id" uuid NOT NULL,
	"bank_allocation_id" uuid NOT NULL,
	"allocated_gross_weight_grams" numeric(14, 4) NOT NULL,
	"allocated_fine_weight_grams" numeric(14, 4) NOT NULL,
	"price_per_gram_mnt" numeric(18, 4),
	"calculated_gross_amount_mnt" numeric(18, 2),
	"deduction_amount_mnt" numeric(18, 2) DEFAULT '0' NOT NULL,
	"net_payable_amount_mnt" numeric(18, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bom_confirmation_allocations_gross_weight_positive" CHECK ("bom_confirmation_allocations"."allocated_gross_weight_grams" > 0),
	CONSTRAINT "bom_confirmation_allocations_fine_weight_nonnegative" CHECK ("bom_confirmation_allocations"."allocated_fine_weight_grams" >= 0),
	CONSTRAINT "bom_confirmation_allocations_deduction_nonnegative" CHECK ("bom_confirmation_allocations"."deduction_amount_mnt" >= 0)
);
--> statement-breakpoint
CREATE TABLE "bom_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assay_record_id" uuid NOT NULL,
	"result_revision_id" uuid NOT NULL,
	"confirmation_no" varchar(80) NOT NULL,
	"version_no" integer DEFAULT 1 NOT NULL,
	"status" "bom_confirmation_status" DEFAULT 'pending' NOT NULL,
	"confirmed_by_user_id" uuid,
	"price_per_gram_mnt" numeric(18, 4),
	"calculated_gross_amount_mnt" numeric(18, 2),
	"deduction_amount_mnt" numeric(18, 2) DEFAULT '0' NOT NULL,
	"net_payable_amount_mnt" numeric(18, 2),
	"calculation_payload_hash" varchar(128),
	"confirmation_notes" text,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bom_confirmations_version_positive" CHECK ("bom_confirmations"."version_no" > 0),
	CONSTRAINT "bom_confirmations_price_positive_or_null" CHECK ("bom_confirmations"."price_per_gram_mnt" IS NULL OR "bom_confirmations"."price_per_gram_mnt" > 0),
	CONSTRAINT "bom_confirmations_deduction_nonnegative" CHECK ("bom_confirmations"."deduction_amount_mnt" >= 0)
);
--> statement-breakpoint
CREATE TABLE "bom_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assay_record_id" uuid NOT NULL,
	"result_revision_id" uuid NOT NULL,
	"status" "bom_submission_status" DEFAULT 'queued' NOT NULL,
	"submitted_by_user_id" uuid NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"payload_hash" varchar(128) NOT NULL,
	"bom_reference" varchar(120),
	"response_code" varchar(64),
	"response_body_hash" varchar(128),
	"error_message" text,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "correction_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assay_record_id" uuid NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"reviewed_by_user_id" uuid,
	"status" "correction_status" DEFAULT 'requested' NOT NULL,
	"reason" text NOT NULL,
	"target_entity_type" varchar(80) NOT NULL,
	"target_entity_id" uuid NOT NULL,
	"proposed_changes" jsonb NOT NULL,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "correction_requests_maker_checker" CHECK ("correction_requests"."reviewed_by_user_id" IS NULL OR "correction_requests"."reviewed_by_user_id" <> "correction_requests"."requested_by_user_id")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "customer_type" NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"registration_number_encrypted" text,
	"registration_number_hash" varchar(128),
	"phone_encrypted" text,
	"phone_hash" varchar(128),
	"email_encrypted" text,
	"address_encrypted" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"email" varchar(255),
	"outcome" "login_event_outcome" NOT NULL,
	"ip_hash" varchar(128),
	"user_agent" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "organization_type" NOT NULL,
	"status" "organization_status" DEFAULT 'active' NOT NULL,
	"code" varchar(32) NOT NULL,
	"name" varchar(255) NOT NULL,
	"registration_number" varchar(64),
	"contact_email" varchar(255),
	"contact_phone_encrypted" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"role" "user_role" NOT NULL,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"token_hash" varchar(128) NOT NULL,
	"invited_by_user_id" uuid NOT NULL,
	"accepted_by_user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_invitations_maker_checker" CHECK ("user_invitations"."accepted_by_user_id" IS NULL OR "user_invitations"."accepted_by_user_id" <> "user_invitations"."invited_by_user_id")
);
--> statement-breakpoint
CREATE TABLE "user_organization_access" (
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"granted_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_organization_access_pk" PRIMARY KEY("user_id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "session_status" DEFAULT 'active' NOT NULL,
	"session_token_hash" varchar(128) NOT NULL,
	"refresh_token_hash" varchar(128),
	"ip_hash" varchar(128),
	"user_agent" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"role" "user_role" NOT NULL,
	"status" "user_status" DEFAULT 'invited' NOT NULL,
	"email" varchar(255) NOT NULL,
	"full_name" varchar(255) NOT NULL,
	"password_hash" text,
	"password_updated_at" timestamp with time zone,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_failed_login_count_nonnegative" CHECK ("users"."failed_login_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "api_clients" ADD CONSTRAINT "api_clients_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_request_logs" ADD CONSTRAINT "api_request_logs_api_client_id_api_clients_id_fk" FOREIGN KEY ("api_client_id") REFERENCES "public"."api_clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assay_certificates" ADD CONSTRAINT "assay_certificates_assay_record_id_assay_records_id_fk" FOREIGN KEY ("assay_record_id") REFERENCES "public"."assay_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assay_certificates" ADD CONSTRAINT "assay_certificates_result_revision_id_assay_result_revisions_id_fk" FOREIGN KEY ("result_revision_id") REFERENCES "public"."assay_result_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assay_certificates" ADD CONSTRAINT "assay_certificates_issued_by_user_id_users_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assay_records" ADD CONSTRAINT "assay_records_assay_center_id_organizations_id_fk" FOREIGN KEY ("assay_center_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assay_records" ADD CONSTRAINT "assay_records_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assay_records" ADD CONSTRAINT "assay_records_intake_officer_id_users_id_fk" FOREIGN KEY ("intake_officer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assay_records" ADD CONSTRAINT "assay_records_locked_by_user_id_users_id_fk" FOREIGN KEY ("locked_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assay_result_revisions" ADD CONSTRAINT "assay_result_revisions_assay_record_id_assay_records_id_fk" FOREIGN KEY ("assay_record_id") REFERENCES "public"."assay_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assay_result_revisions" ADD CONSTRAINT "assay_result_revisions_entered_by_user_id_users_id_fk" FOREIGN KEY ("entered_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assay_result_revisions" ADD CONSTRAINT "assay_result_revisions_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assay_samples" ADD CONSTRAINT "assay_samples_assay_record_id_assay_records_id_fk" FOREIGN KEY ("assay_record_id") REFERENCES "public"."assay_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assay_samples" ADD CONSTRAINT "assay_samples_received_by_user_id_users_id_fk" FOREIGN KEY ("received_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_organization_id_organizations_id_fk" FOREIGN KEY ("actor_organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_allocations" ADD CONSTRAINT "bank_allocations_assay_record_id_assay_records_id_fk" FOREIGN KEY ("assay_record_id") REFERENCES "public"."assay_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_allocations" ADD CONSTRAINT "bank_allocations_bank_organization_id_organizations_id_fk" FOREIGN KEY ("bank_organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_allocations" ADD CONSTRAINT "bank_allocations_accepted_by_bank_user_id_users_id_fk" FOREIGN KEY ("accepted_by_bank_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_allocations" ADD CONSTRAINT "bank_allocations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_settlements" ADD CONSTRAINT "bank_settlements_bank_allocation_id_bank_allocations_id_fk" FOREIGN KEY ("bank_allocation_id") REFERENCES "public"."bank_allocations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_settlements" ADD CONSTRAINT "bank_settlements_bom_confirmation_allocation_id_bom_confirmation_allocations_id_fk" FOREIGN KEY ("bom_confirmation_allocation_id") REFERENCES "public"."bom_confirmation_allocations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_settlements" ADD CONSTRAINT "bank_settlements_bank_user_id_users_id_fk" FOREIGN KEY ("bank_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_confirmation_allocations" ADD CONSTRAINT "bom_confirmation_allocations_bom_confirmation_id_bom_confirmations_id_fk" FOREIGN KEY ("bom_confirmation_id") REFERENCES "public"."bom_confirmations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_confirmation_allocations" ADD CONSTRAINT "bom_confirmation_allocations_bank_allocation_id_bank_allocations_id_fk" FOREIGN KEY ("bank_allocation_id") REFERENCES "public"."bank_allocations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_confirmations" ADD CONSTRAINT "bom_confirmations_assay_record_id_assay_records_id_fk" FOREIGN KEY ("assay_record_id") REFERENCES "public"."assay_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_confirmations" ADD CONSTRAINT "bom_confirmations_result_revision_id_assay_result_revisions_id_fk" FOREIGN KEY ("result_revision_id") REFERENCES "public"."assay_result_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_confirmations" ADD CONSTRAINT "bom_confirmations_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_submissions" ADD CONSTRAINT "bom_submissions_assay_record_id_assay_records_id_fk" FOREIGN KEY ("assay_record_id") REFERENCES "public"."assay_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_submissions" ADD CONSTRAINT "bom_submissions_result_revision_id_assay_result_revisions_id_fk" FOREIGN KEY ("result_revision_id") REFERENCES "public"."assay_result_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_submissions" ADD CONSTRAINT "bom_submissions_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction_requests" ADD CONSTRAINT "correction_requests_assay_record_id_assay_records_id_fk" FOREIGN KEY ("assay_record_id") REFERENCES "public"."assay_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction_requests" ADD CONSTRAINT "correction_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction_requests" ADD CONSTRAINT "correction_requests_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_events" ADD CONSTRAINT "login_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_organization_access" ADD CONSTRAINT "user_organization_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_organization_access" ADD CONSTRAINT "user_organization_access_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_organization_access" ADD CONSTRAINT "user_organization_access_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_clients_client_id_uidx" ON "api_clients" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "api_clients_organization_idx" ON "api_clients" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "api_clients_status_idx" ON "api_clients" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "api_request_logs_request_id_uidx" ON "api_request_logs" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "api_request_logs_client_created_idx" ON "api_request_logs" USING btree ("api_client_id","created_at");--> statement-breakpoint
CREATE INDEX "api_request_logs_idempotency_idx" ON "api_request_logs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "assay_certificates_no_uidx" ON "assay_certificates" USING btree ("certificate_no");--> statement-breakpoint
CREATE INDEX "assay_certificates_record_idx" ON "assay_certificates" USING btree ("assay_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assay_records_public_id_uidx" ON "assay_records" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "assay_records_center_status_idx" ON "assay_records" USING btree ("assay_center_id","status");--> statement-breakpoint
CREATE INDEX "assay_records_customer_idx" ON "assay_records" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "assay_records_received_at_idx" ON "assay_records" USING btree ("received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "assay_result_revisions_record_revision_uidx" ON "assay_result_revisions" USING btree ("assay_record_id","revision_no");--> statement-breakpoint
CREATE INDEX "assay_result_revisions_record_status_idx" ON "assay_result_revisions" USING btree ("assay_record_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "assay_samples_record_no_uidx" ON "assay_samples" USING btree ("assay_record_id","sample_no");--> statement-breakpoint
CREATE INDEX "assay_samples_seal_number_idx" ON "assay_samples" USING btree ("seal_number");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_logs_entry_hash_uidx" ON "audit_logs" USING btree ("entry_hash");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_created_idx" ON "audit_logs" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_request_idx" ON "audit_logs" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_allocations_record_bank_uidx" ON "bank_allocations" USING btree ("assay_record_id","bank_organization_id");--> statement-breakpoint
CREATE INDEX "bank_allocations_bank_status_idx" ON "bank_allocations" USING btree ("bank_organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_settlements_allocation_uidx" ON "bank_settlements" USING btree ("bank_allocation_id");--> statement-breakpoint
CREATE INDEX "bank_settlements_confirmation_allocation_idx" ON "bank_settlements" USING btree ("bom_confirmation_allocation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bom_confirmation_allocations_confirmation_allocation_uidx" ON "bom_confirmation_allocations" USING btree ("bom_confirmation_id","bank_allocation_id");--> statement-breakpoint
CREATE INDEX "bom_confirmation_allocations_allocation_idx" ON "bom_confirmation_allocations" USING btree ("bank_allocation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bom_confirmations_no_version_uidx" ON "bom_confirmations" USING btree ("confirmation_no","version_no");--> statement-breakpoint
CREATE INDEX "bom_confirmations_record_status_idx" ON "bom_confirmations" USING btree ("assay_record_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "bom_submissions_idempotency_uidx" ON "bom_submissions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "bom_submissions_record_status_idx" ON "bom_submissions" USING btree ("assay_record_id","status");--> statement-breakpoint
CREATE INDEX "correction_requests_record_status_idx" ON "correction_requests" USING btree ("assay_record_id","status");--> statement-breakpoint
CREATE INDEX "customers_type_idx" ON "customers" USING btree ("type");--> statement-breakpoint
CREATE INDEX "customers_display_name_idx" ON "customers" USING btree ("display_name");--> statement-breakpoint
CREATE INDEX "customers_registration_hash_idx" ON "customers" USING btree ("registration_number_hash");--> statement-breakpoint
CREATE INDEX "customers_phone_hash_idx" ON "customers" USING btree ("phone_hash");--> statement-breakpoint
CREATE INDEX "login_events_user_created_idx" ON "login_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "login_events_email_created_idx" ON "login_events" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "login_events_outcome_idx" ON "login_events" USING btree ("outcome");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_code_uidx" ON "organizations" USING btree ("code");--> statement-breakpoint
CREATE INDEX "organizations_type_idx" ON "organizations" USING btree ("type");--> statement-breakpoint
CREATE INDEX "organizations_status_idx" ON "organizations" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "user_invitations_token_hash_uidx" ON "user_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "user_invitations_email_status_idx" ON "user_invitations" USING btree ("email","status");--> statement-breakpoint
CREATE INDEX "user_invitations_organization_idx" ON "user_invitations" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_sessions_session_token_uidx" ON "user_sessions" USING btree ("session_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "user_sessions_refresh_token_uidx" ON "user_sessions" USING btree ("refresh_token_hash");--> statement-breakpoint
CREATE INDEX "user_sessions_user_status_idx" ON "user_sessions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "user_sessions_expires_at_idx" ON "user_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uidx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_organization_idx" ON "users" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");