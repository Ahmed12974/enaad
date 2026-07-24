-- Compatibility repair for databases that previously ran the alternate
-- 0015_section_localization_and_activation.sql branch. That branch created the
-- same constraint name with a different set of sectionType values. Preserve all
-- rows, normalize only legacy values, and install the canonical application rule.
UPDATE "educationalSections"
SET "sectionType" = CASE "sectionType"
  WHEN 'arabic' THEN 'language'
  WHEN 'english' THEN 'language'
  WHEN 'general' THEN 'subject'
  ELSE "sectionType"
END,
"updatedAt" = now()
WHERE "sectionType" IN ('arabic', 'english', 'general');

UPDATE "educationalSections"
SET "sectionType" = 'custom', "updatedAt" = now()
WHERE "sectionType" NOT IN ('subject', 'language', 'reading', 'math', 'skills', 'custom');

ALTER TABLE "educationalSections"
  DROP CONSTRAINT IF EXISTS educational_sections_type_check;

ALTER TABLE "educationalSections"
  ADD CONSTRAINT educational_sections_type_check
  CHECK ("sectionType" IN ('subject', 'language', 'reading', 'math', 'skills', 'custom'));

-- The alternate branch added nameAr as NOT NULL without a default. The canonical
-- application writes name + nameEn and does not know that legacy-only column, so
-- retaining the NOT NULL rule would make every new section insert fail. Preserve
-- the legacy values but make the compatibility-only column optional.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'educationalSections'
      AND column_name = 'nameAr'
  ) THEN
    -- Source-branch forms treated nameAr as the canonical Arabic title. Copy
    -- any later edits into the canonical name column before making the legacy
    -- compatibility column optional, so backup/export through Drizzle retains
    -- the latest Arabic label.
    UPDATE "educationalSections"
    SET "name" = "nameAr", "updatedAt" = now()
    WHERE "nameAr" IS NOT NULL
      AND btrim("nameAr") <> ''
      AND "name" IS DISTINCT FROM "nameAr";

    ALTER TABLE "educationalSections" ALTER COLUMN "nameAr" DROP NOT NULL;
  END IF;
END $$;

-- The alternate branch also used a different default. Keep schema and application
-- behavior aligned for inserts that omit sectionType.
ALTER TABLE "educationalSections"
  ALTER COLUMN "sectionType" SET DEFAULT 'subject';

CREATE INDEX IF NOT EXISTS educational_sections_active_status_order_idx
  ON "educationalSections" ("isActive", status, "sortOrder")
  WHERE "deletedAt" IS NULL;
