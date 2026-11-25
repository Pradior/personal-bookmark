CREATE TABLE "site_credential" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" varchar(200) NOT NULL,
	"cookie_cipher" text NOT NULL,
	"user_agent" text,
	"referer" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"note" varchar(200),
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "site_credential_domain_idx" ON "site_credential" USING btree ("domain");