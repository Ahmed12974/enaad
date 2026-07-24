ALTER TABLE "educationalSections"
  ADD COLUMN IF NOT EXISTS "nameEn" text,
  ADD COLUMN IF NOT EXISTS "sectionType" text NOT NULL DEFAULT 'subject',
  ADD COLUMN IF NOT EXISTS "previousSectionId" uuid,
  ADD COLUMN IF NOT EXISTS "isPaid" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "priceMinor" integer,
  ADD COLUMN IF NOT EXISTS "currency" text NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS "isActive" boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'educationalSections_previousSectionId_educationalSections_id_fk'
  ) THEN
    ALTER TABLE "educationalSections"
      ADD CONSTRAINT "educationalSections_previousSectionId_educationalSections_id_fk"
      FOREIGN KEY ("previousSectionId") REFERENCES "educationalSections"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'educational_sections_type_check') THEN
    ALTER TABLE "educationalSections" ADD CONSTRAINT "educational_sections_type_check"
      CHECK ("sectionType" IN ('subject','language','reading','math','skills','custom'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'educational_sections_price_check') THEN
    ALTER TABLE "educationalSections" ADD CONSTRAINT "educational_sections_price_check"
      CHECK (("isPaid" = false AND ("priceMinor" IS NULL OR "priceMinor" = 0)) OR
             ("isPaid" = true AND "priceMinor" IS NOT NULL AND "priceMinor" > 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'educational_sections_currency_check') THEN
    ALTER TABLE "educationalSections" ADD CONSTRAINT "educational_sections_currency_check"
      CHECK ("currency" ~ '^[A-Z]{3}$');
  END IF;
END $$;

-- Preserve existing data while making active section names unique. Only duplicate
-- rows are disambiguated by their already-unique slug before the index is added.
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY lower(trim(name)) ORDER BY "createdAt", id) AS rn
  FROM "educationalSections"
  WHERE "deletedAt" IS NULL
)
UPDATE "educationalSections" s
SET name = s.name || ' (' || s.slug || ')', "updatedAt" = now()
FROM ranked r
WHERE r.id = s.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS educational_sections_name_active_unique
  ON "educationalSections" (lower(trim(name))) WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS educational_sections_previous_idx
  ON "educationalSections" ("previousSectionId");
DROP INDEX IF EXISTS educational_sections_status_order_idx;
CREATE INDEX IF NOT EXISTS educational_sections_status_order_idx
  ON "educationalSections" (status, "isActive", "sortOrder");
