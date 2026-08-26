CREATE TYPE "public"."curator_complexity" AS ENUM('LOW', 'MEDIUM', 'HIGH');--> statement-breakpoint
CREATE TYPE "public"."curator_provider" AS ENUM('MOCK', 'OLLAMA');--> statement-breakpoint
CREATE TYPE "public"."curator_run_status" AS ENUM('SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."curator_verdict" AS ENUM('DUPLICATE', 'VARIANT_OF', 'IMPROVEMENT_ON', 'CONFLICTS_WITH', 'NEW', 'UNKNOWN');--> statement-breakpoint
CREATE TABLE "curator_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"contribution_id" uuid NOT NULL,
	"status" "curator_run_status" NOT NULL,
	"provider" "curator_provider" NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"complexity" "curator_complexity" NOT NULL,
	"rounds_used" integer DEFAULT 0 NOT NULL,
	"verdict" "curator_verdict",
	"related_asset_id" uuid,
	"related_asset_key" text,
	"confidence" real,
	"reasoning" text DEFAULT '' NOT NULL,
	"suggested_validations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"failure_code" text,
	"failure_message" text DEFAULT '' NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "curator_runs" ADD CONSTRAINT "curator_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curator_runs" ADD CONSTRAINT "curator_runs_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contributions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curator_runs" ADD CONSTRAINT "curator_runs_related_asset_id_harness_assets_id_fk" FOREIGN KEY ("related_asset_id") REFERENCES "public"."harness_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "curator_runs_contribution_idx" ON "curator_runs" USING btree ("contribution_id","created_at");--> statement-breakpoint
CREATE INDEX "curator_runs_org_idx" ON "curator_runs" USING btree ("organization_id");