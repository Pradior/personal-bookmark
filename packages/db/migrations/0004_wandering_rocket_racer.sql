DROP INDEX "item_canonical_url_idx";--> statement-breakpoint
ALTER TABLE "item" ALTER COLUMN "url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "item" ALTER COLUMN "canonical_url" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "item_canonical_url_idx" ON "item" USING btree ("canonical_url") WHERE "canonical_url" IS NOT NULL;