ALTER TABLE "rateLimit" DROP CONSTRAINT "rateLimit_pkey";--> statement-breakpoint
ALTER TABLE "rateLimit" ADD COLUMN "id" text PRIMARY KEY NOT NULL;--> statement-breakpoint
ALTER TABLE "rateLimit" ADD CONSTRAINT "rateLimit_key_unique" UNIQUE("key");
