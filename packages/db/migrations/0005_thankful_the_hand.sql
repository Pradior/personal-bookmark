ALTER TYPE "public"."item_status" ADD VALUE 'trashed';--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "trashed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "item_trashed_idx" ON "item" USING btree ("trashed_at");