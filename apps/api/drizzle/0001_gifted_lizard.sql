CREATE TYPE "public"."asset_owner_type" AS ENUM('USER', 'TEAM', 'GROUP', 'PROJECT');--> statement-breakpoint
CREATE TYPE "public"."asset_relation_type" AS ENUM('DEPENDS_ON', 'EXTENDS', 'VARIANT_OF', 'SUPERSEDES', 'CONFLICTS_WITH', 'VALIDATES', 'REFERENCES');--> statement-breakpoint
CREATE TYPE "public"."asset_status" AS ENUM('DRAFT', 'ACTIVE', 'DEPRECATED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."asset_version_status" AS ENUM('DRAFT', 'CANDIDATE', 'ACTIVE', 'SUPERSEDED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."capability_owner_type" AS ENUM('TEAM', 'GROUP', 'PROJECT');--> statement-breakpoint
CREATE TYPE "public"."harness_asset_type" AS ENUM('RULE', 'SKILL', 'WORKFLOW', 'KNOWLEDGE', 'VALIDATION', 'VARIANT', 'SCRIPT', 'TEMPLATE', 'POLICY');--> statement-breakpoint
CREATE TYPE "public"."inheritance_mode" AS ENUM('LOCKED', 'EXTENDABLE', 'OVERRIDABLE', 'DEFAULT');--> statement-breakpoint
CREATE TYPE "public"."scope_type" AS ENUM('COMPANY', 'TEAM', 'PROJECT', 'PERSONAL');--> statement-breakpoint
CREATE TABLE "asset_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_asset_id" uuid NOT NULL,
	"to_asset_id" uuid NOT NULL,
	"type" "asset_relation_type" NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_relations_unique" UNIQUE("from_asset_id","to_asset_id","type"),
	CONSTRAINT "asset_relations_no_self" CHECK ("asset_relations"."from_asset_id" <> "asset_relations"."to_asset_id")
);
--> statement-breakpoint
CREATE TABLE "asset_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"version" text NOT NULL,
	"status" "asset_version_status" DEFAULT 'DRAFT' NOT NULL,
	"structured_content" jsonb NOT NULL,
	"rendered_markdown" text,
	"summary" text DEFAULT '' NOT NULL,
	"estimated_tokens" integer,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_versions_asset_version_unique" UNIQUE("asset_id","version")
);
--> statement-breakpoint
CREATE TABLE "capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"parent_id" uuid,
	"owner_type" "capability_owner_type" NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capabilities_org_key_unique" UNIQUE("organization_id","key")
);
--> statement-breakpoint
CREATE TABLE "harness_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"capability_id" uuid,
	"type" "harness_asset_type" NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"scope_type" "scope_type" NOT NULL,
	"scope_id" uuid NOT NULL,
	"inheritance_mode" "inheritance_mode" DEFAULT 'DEFAULT' NOT NULL,
	"status" "asset_status" DEFAULT 'DRAFT' NOT NULL,
	"owner_type" "asset_owner_type" NOT NULL,
	"owner_id" uuid NOT NULL,
	"selector" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"review_after" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "harness_assets_identity_unique" UNIQUE("organization_id","key","scope_type","scope_id")
);
--> statement-breakpoint
ALTER TABLE "asset_relations" ADD CONSTRAINT "asset_relations_from_asset_id_harness_assets_id_fk" FOREIGN KEY ("from_asset_id") REFERENCES "public"."harness_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_relations" ADD CONSTRAINT "asset_relations_to_asset_id_harness_assets_id_fk" FOREIGN KEY ("to_asset_id") REFERENCES "public"."harness_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_relations" ADD CONSTRAINT "asset_relations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_versions" ADD CONSTRAINT "asset_versions_asset_id_harness_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."harness_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_versions" ADD CONSTRAINT "asset_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_parent_id_capabilities_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."capabilities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harness_assets" ADD CONSTRAINT "harness_assets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harness_assets" ADD CONSTRAINT "harness_assets_capability_id_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."capabilities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harness_assets" ADD CONSTRAINT "harness_assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_relations_to_idx" ON "asset_relations" USING btree ("to_asset_id");--> statement-breakpoint
CREATE INDEX "asset_versions_asset_status_idx" ON "asset_versions" USING btree ("asset_id","status");--> statement-breakpoint
CREATE INDEX "capabilities_parent_idx" ON "capabilities" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "harness_assets_org_status_idx" ON "harness_assets" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "harness_assets_scope_idx" ON "harness_assets" USING btree ("scope_type","scope_id");--> statement-breakpoint
CREATE INDEX "harness_assets_capability_idx" ON "harness_assets" USING btree ("capability_id");--> statement-breakpoint
CREATE INDEX "harness_assets_key_idx" ON "harness_assets" USING btree ("organization_id","key");