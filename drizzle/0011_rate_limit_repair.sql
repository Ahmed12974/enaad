CREATE TABLE IF NOT EXISTS "rateLimit" (
  "id" text PRIMARY KEY,
  "key" text NOT NULL UNIQUE,
  "count" integer NOT NULL,
  "lastRequest" bigint NOT NULL
);

ALTER TABLE "rateLimit" ADD COLUMN IF NOT EXISTS "id" text;

UPDATE "rateLimit"
SET "id" = md5(random()::text || clock_timestamp()::text || "key")
WHERE "id" IS NULL OR "id" = '';

ALTER TABLE "rateLimit" ALTER COLUMN "id" SET NOT NULL;

DO $$
DECLARE
  current_pk text;
  current_pk_has_id boolean;
BEGIN
  SELECT
    constraint_record.conname,
    EXISTS (
      SELECT 1
      FROM unnest(constraint_record.conkey) AS key_column(attnum)
      JOIN pg_attribute attribute_record
        ON attribute_record.attrelid = constraint_record.conrelid
       AND attribute_record.attnum = key_column.attnum
      WHERE attribute_record.attname = 'id'
    )
  INTO current_pk, current_pk_has_id
  FROM pg_constraint constraint_record
  WHERE constraint_record.conrelid = 'public."rateLimit"'::regclass
    AND constraint_record.contype = 'p'
  LIMIT 1;

  IF current_pk IS NOT NULL AND NOT current_pk_has_id THEN
    EXECUTE format('ALTER TABLE "rateLimit" DROP CONSTRAINT %I', current_pk);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_record
    JOIN unnest(constraint_record.conkey) AS key_column(attnum) ON true
    JOIN pg_attribute attribute_record
      ON attribute_record.attrelid = constraint_record.conrelid
     AND attribute_record.attnum = key_column.attnum
    WHERE constraint_record.conrelid = 'public."rateLimit"'::regclass
      AND constraint_record.contype = 'p'
      AND attribute_record.attname = 'id'
  ) THEN
    ALTER TABLE "rateLimit" ADD CONSTRAINT "rateLimit_pkey" PRIMARY KEY ("id");
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "rateLimit_key_unique" ON "rateLimit" ("key");
