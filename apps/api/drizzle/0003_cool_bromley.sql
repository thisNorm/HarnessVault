CREATE TYPE "public"."policy_effect" AS ENUM('ALLOW', 'APPROVAL_REQUIRED', 'DENY');--> statement-breakpoint
CREATE TABLE "resource_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"effect" "policy_effect" NOT NULL,
	"scope_type" "scope_type" NOT NULL,
	"scope_id" uuid NOT NULL,
	"inheritance_mode" "inheritance_mode" DEFAULT 'DEFAULT' NOT NULL,
	"resource_id" uuid,
	"resource_type" "resource_type",
	"classification" "resource_classification",
	"actions" jsonb DEFAULT '["*"]'::jsonb NOT NULL,
	"subject_org_role" "organization_role",
	"subject_group_id" uuid,
	"approval_policy_id" uuid,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_policies_org_name_unique" UNIQUE("organization_id","name")
);
--> statement-breakpoint
ALTER TABLE "resource_policies" ADD CONSTRAINT "resource_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_policies" ADD CONSTRAINT "resource_policies_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_policies" ADD CONSTRAINT "resource_policies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "resource_policies_org_enabled_idx" ON "resource_policies" USING btree ("organization_id","enabled");--> statement-breakpoint
CREATE INDEX "resource_policies_scope_idx" ON "resource_policies" USING btree ("scope_type","scope_id");