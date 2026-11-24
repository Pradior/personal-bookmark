DROP INDEX "asset_sha256_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "asset_item_sha_idx" ON "asset" USING btree ("item_id","sha256");--> statement-breakpoint
CREATE INDEX "asset_sha256_idx" ON "asset" USING btree ("sha256");