INSERT INTO "platformSettings" ("key", "value", "createdAt", "updatedAt")
VALUES (
  'general',
  jsonb_build_object(
    'siteName', 'أكاديمية زايد التعليمية',
    'siteDescription', 'منصة تعليمية متكاملة لتعلّم العربية والإنجليزية والرياضيات، مع الاختبارات والتحديات والإنجازات.',
    'timezone', 'Africa/Cairo',
    'defaultLanguage', 'ar',
    'arabicEnabled', true,
    'englishEnabled', true,
    'registrationEnabled', true,
    'maintenanceMode', false,
    'maxUploadMb', 5
  ),
  now(),
  now()
)
ON CONFLICT ("key") DO UPDATE
SET
  "value" = jsonb_set(
    jsonb_set(
      "platformSettings"."value",
      '{siteName}',
      to_jsonb('أكاديمية زايد التعليمية'::text),
      true
    ),
    '{siteDescription}',
    to_jsonb('منصة تعليمية متكاملة لتعلّم العربية والإنجليزية والرياضيات، مع الاختبارات والتحديات والإنجازات.'::text),
    true
  ),
  "updatedAt" = now()
WHERE "platformSettings"."key" = 'general'
  AND coalesce(trim("platformSettings"."value"->>'siteName'), '') IN ('', 'لُغتي', 'لغتي');
