CREATE TYPE "public"."item_fetch_state" AS ENUM('queued', 'fetching', 'assets', 'done', 'failed');--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "fetch_state" "item_fetch_state" DEFAULT 'done' NOT NULL;--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "fetch_error" text;--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "fetched_at" timestamp with time zone;