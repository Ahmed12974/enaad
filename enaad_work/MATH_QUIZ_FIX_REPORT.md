# Math Quiz Production Fix

- Added an idempotent seed bank with 30 active questions for each built-in math section: basics, fractions, and algebra.
- Kept question insertion safe with the existing unique constraint and `onConflictDoNothing()`.
- Changed expected “not enough questions” outcomes from thrown Server Action errors to structured results, preventing the generic production Server Components error screen.
- The existing Vercel build command runs migrations, seed, then build, so redeploying populates the missing question bank automatically.
