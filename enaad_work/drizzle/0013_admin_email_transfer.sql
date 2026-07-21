-- Transfer sole-owner administration from the previous email to the new owner.
-- The old account is preserved as a normal user, but it loses all admin access.

INSERT INTO "adminAllowlist" ("email", "role", "isActive", "createdAt", "updatedAt")
VALUES ('enaad4786@gmail.com', 'SUPER_ADMIN', TRUE, now(), now())
ON CONFLICT ("email") DO UPDATE
SET "role" = 'SUPER_ADMIN',
    "isActive" = TRUE,
    "updatedAt" = now();

UPDATE "adminAllowlist"
SET "isActive" = FALSE,
    "updatedAt" = now()
WHERE lower(trim("email")) = 'enaadx@gmail.com';

UPDATE "user"
SET "role" = 'user',
    "updatedAt" = now()
WHERE lower(trim("email")) = 'enaadx@gmail.com'
  AND "deletedAt" IS NULL
  AND "role" = 'admin';

UPDATE "user"
SET "role" = 'admin',
    "emailVerified" = TRUE,
    "banned" = FALSE,
    "banReason" = NULL,
    "banExpires" = NULL,
    "updatedAt" = now()
WHERE lower(trim("email")) = 'enaad4786@gmail.com'
  AND "deletedAt" IS NULL;
