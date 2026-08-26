CREATE TABLE "trace_asset_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trace_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"version_id" uuid,
	"selected" boolean NOT NULL,
	"reason_code" text NOT NULL,
	"asset_type" "harness_asset_type" NOT NULL,
	"scope_type" "scope_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trace_asset_usage" ADD CONSTRAINT "trace_asset_usage_trace_id_task_traces_id_fk" FOREIGN KEY ("trace_id") REFERENCES "public"."task_traces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trace_asset_usage" ADD CONSTRAINT "trace_asset_usage_asset_id_harness_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."harness_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trace_asset_usage" ADD CONSTRAINT "trace_asset_usage_version_id_asset_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."asset_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trace_asset_usage_trace_idx" ON "trace_asset_usage" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "trace_asset_usage_asset_idx" ON "trace_asset_usage" USING btree ("asset_id","selected");--> statement-breakpoint
CREATE INDEX "trace_asset_usage_created_idx" ON "trace_asset_usage" USING btree ("created_at");