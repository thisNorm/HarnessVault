CREATE TYPE "public"."model_source" AS ENUM('VERIFIED', 'CLIENT_REPORTED', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."trace_status" AS ENUM('OPEN', 'COMPLETED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "task_traces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid,
	"client_name" text,
	"client_version" text,
	"model_name" text,
	"model_source" "model_source" DEFAULT 'UNKNOWN' NOT NULL,
	"purpose" text NOT NULL,
	"status" "trace_status" DEFAULT 'OPEN' NOT NULL,
	"summary" text,
	"candidate_asset_count" integer,
	"selected_asset_count" integer,
	"estimated_available_tokens" integer,
	"estimated_injected_tokens" integer,
	"harness_input_tokens" integer,
	"harness_output_tokens" integer,
	"curator_input_tokens" integer,
	"curator_reasoning_tokens" integer,
	"curator_output_tokens" integer,
	"client_reported_input_tokens" integer,
	"client_reported_output_tokens" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "trace_id" uuid;--> statement-breakpoint
ALTER TABLE "task_traces" ADD CONSTRAINT "task_traces_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_traces" ADD CONSTRAINT "task_traces_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_traces" ADD CONSTRAINT "task_traces_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_traces_org_started_idx" ON "task_traces" USING btree ("organization_id","started_at");--> statement-breakpoint
CREATE INDEX "task_traces_user_idx" ON "task_traces" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "task_traces_status_idx" ON "task_traces" USING btree ("organization_id","status");--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_trace_id_task_traces_id_fk" FOREIGN KEY ("trace_id") REFERENCES "public"."task_traces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_trace_idx" ON "audit_events" USING btree ("trace_id","created_at");