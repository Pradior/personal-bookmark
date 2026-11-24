CREATE TYPE "public"."asset_kind" AS ENUM('image', 'thumbnail', 'pdf', 'video', 'audio', 'cover');--> statement-breakpoint
CREATE TYPE "public"."asset_variant_kind" AS ENUM('thumb', 'display');--> statement-breakpoint
CREATE TYPE "public"."item_source" AS ENUM('wechat', 'xhs', 'douyin', 'web', 'manual');--> statement-breakpoint
CREATE TYPE "public"."item_status" AS ENUM('inbox', 'reading', 'archived');--> statement-breakpoint
CREATE TYPE "public"."item_type" AS ENUM('article', 'note', 'image', 'video', 'link');--> statement-breakpoint
CREATE TYPE "public"."tag_source" AS ENUM('manual', 'rule', 'propagated', 'llm');--> statement-breakpoint
CREATE TABLE "access_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(80) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"prefix" varchar(12) NOT NULL,
	"scopes" text[] DEFAULT '{capture,read}'::text[] NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid,
	"kind" "asset_kind" DEFAULT 'image' NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"source_mime" varchar(64),
	"source_width" integer,
	"source_height" integer,
	"source_bytes" integer,
	"mime" varchar(64) NOT NULL,
	"width" integer,
	"height" integer,
	"bytes" integer DEFAULT 0 NOT NULL,
	"animated" boolean DEFAULT false NOT NULL,
	"origin_url" text,
	"origin_referer" text,
	"origin_user_agent" text,
	"source_available" boolean DEFAULT true NOT NULL,
	"source_status" varchar(16) DEFAULT 'unknown' NOT NULL,
	"source_checked_at" timestamp with time zone,
	"source_fail_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_variant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"variant" "asset_variant_kind" NOT NULL,
	"storage_key" text NOT NULL,
	"mime" varchar(64) NOT NULL,
	"bytes" integer DEFAULT 0 NOT NULL,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"name" varchar(120) NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"ai_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "highlight" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"quote" text NOT NULL,
	"prefix" text DEFAULT '' NOT NULL,
	"suffix" text DEFAULT '' NOT NULL,
	"offset" integer DEFAULT 0 NOT NULL,
	"color" varchar(16) DEFAULT 'yellow' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "item_type" DEFAULT 'article' NOT NULL,
	"source" "item_source" DEFAULT 'web' NOT NULL,
	"status" "item_status" DEFAULT 'inbox' NOT NULL,
	"url" text NOT NULL,
	"canonical_url" text NOT NULL,
	"title" text,
	"author" text,
	"site_name" text,
	"excerpt" text,
	"published_at" timestamp with time zone,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"content_html" text,
	"content_text" text,
	"word_count" integer DEFAULT 0 NOT NULL,
	"lang" varchar(16) DEFAULT 'zh',
	"cover_asset_id" uuid,
	"collection_id" uuid,
	"search_text" text DEFAULT '' NOT NULL,
	"simhash" bigint,
	"embedding" vector(512),
	"adapter_id" varchar(32),
	"meta" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_tag" (
	"item_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"source" "tag_source" DEFAULT 'manual' NOT NULL,
	"confidence" real DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"match" jsonb NOT NULL,
	"action" jsonb NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "smart_view" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"filter" jsonb NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"raw_gz" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"bytes" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tag" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(64) NOT NULL,
	"color" varchar(16),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_variant" ADD CONSTRAINT "asset_variant_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection" ADD CONSTRAINT "collection_parent_id_collection_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."collection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "highlight" ADD CONSTRAINT "highlight_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item" ADD CONSTRAINT "item_collection_id_collection_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collection"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_tag" ADD CONSTRAINT "item_tag_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_tag" ADD CONSTRAINT "item_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot" ADD CONSTRAINT "snapshot_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "access_token_hash_idx" ON "access_token" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_sha256_idx" ON "asset" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "asset_item_idx" ON "asset" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_variant_pk" ON "asset_variant" USING btree ("asset_id","variant");--> statement-breakpoint
CREATE INDEX "asset_variant_kind_idx" ON "asset_variant" USING btree ("variant");--> statement-breakpoint
CREATE INDEX "collection_parent_idx" ON "collection" USING btree ("parent_id","sort");--> statement-breakpoint
CREATE INDEX "highlight_item_idx" ON "highlight" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "item_canonical_url_idx" ON "item" USING btree ("canonical_url");--> statement-breakpoint
CREATE INDEX "item_status_saved_idx" ON "item" USING btree ("status","saved_at");--> statement-breakpoint
CREATE INDEX "item_collection_idx" ON "item" USING btree ("collection_id","saved_at");--> statement-breakpoint
CREATE INDEX "item_source_idx" ON "item" USING btree ("source");--> statement-breakpoint
CREATE INDEX "item_simhash_idx" ON "item" USING btree ("simhash");--> statement-breakpoint
CREATE INDEX "item_url_idx" ON "item" USING btree ("url");--> statement-breakpoint
CREATE UNIQUE INDEX "item_tag_pk" ON "item_tag" USING btree ("item_id","tag_id");--> statement-breakpoint
CREATE INDEX "item_tag_tag_idx" ON "item_tag" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "snapshot_item_idx" ON "snapshot" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tag_name_idx" ON "tag" USING btree ("name");