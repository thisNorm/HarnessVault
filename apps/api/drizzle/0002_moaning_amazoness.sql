CREATE TYPE "public"."resource_classification" AS ENUM('PUBLIC', 'INTERNAL', 'RESTRICTED', 'HIGHLY_RESTRICTED');--> statement-breakpoint
CREATE TYPE "public"."resource_owner_type" AS ENUM('TEAM', 'GROUP', 'USER', 'PROJECT');--> statement-breakpoint
CREATE TYPE "public"."resource_type" AS ENUM('FILE_SYSTEM', 'DATABASE', 'GIT', 'INTERNAL_API');--> statement-breakpoint
CREATE TABLE "resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" "resource_type" NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"classification" "resource_classification" DEFAULT 'INTERNAL' NOT NULL,
	"owner_type" "resource_owner_type" NOT NULL,
	"owner_id" uuid NOT NULL,
	"adapter_type" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"credential_ref" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resources_org_name_unique" UNIQUE("organization_id","name")
);
--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "resources_org_type_idx" ON "resources" USING btree ("organization_id","type");