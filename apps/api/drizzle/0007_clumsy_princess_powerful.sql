CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."contribution_status" AS ENUM('CANDIDATE', 'PROMOTED', 'REJECTED', 'WITHDRAWN');--> statement-breakpoint
CREATE TYPE "public"."embedding_status" AS ENUM('NOT_CONFIGURED', 'OK', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."similarity_method" AS ENUM('VECTOR', 'LEXICAL');--> statement-breakpoint
CREATE TABLE "contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"submitted_by_user_id" uuid NOT NULL,
	"trace_id" uuid,
	"status" "contribution_status" DEFAULT 'CANDIDATE' NOT NULL,
	"type" "harness_asset_type" NOT NULL,
	"proposed_key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"rationale" text DEFAULT '' NOT NULL,
	"structured_content" jsonb NOT NULL,
	"capability_id" uuid,
	"proposed_scope_type" "scope_type" NOT NULL,
	"proposed_scope_id" uuid,
	"duplicate_of_asset_id" uuid,
	"duplicate_score" real,
	"similarity_method" "similarity_method" DEFAULT 'LEXICAL' NOT NULL,
	"embedding_status" "embedding_status" DEFAULT 'NOT_CONFIGURED' NOT NULL,
	"embedding" vector(768),
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text DEFAULT '' NOT NULL,
	"promoted_asset_id" uuid,
	"promoted_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "harness_assets" ADD COLUMN "embedding" vector(768);--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_trace_id_task_traces_id_fk" FOREIGN KEY ("trace_id") REFERENCES "public"."task_traces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_capability_id_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."capabilities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_duplicate_of_asset_id_harness_assets_id_fk" FOREIGN KEY ("duplicate_of_asset_id") REFERENCES "public"."harness_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_promoted_asset_id_harness_assets_id_fk" FOREIGN KEY ("promoted_asset_id") REFERENCES "public"."harness_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_promoted_version_id_asset_versions_id_fk" FOREIGN KEY ("promoted_version_id") REFERENCES "public"."asset_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contributions_org_status_idx" ON "contributions" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "contributions_submitter_idx" ON "contributions" USING btree ("submitted_by_user_id");--> statement-breakpoint
CREATE INDEX "contributions_trace_idx" ON "contributions" USING btree ("trace_id");