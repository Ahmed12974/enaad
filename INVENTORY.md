# جرد المسارات والإجراءات والنماذج

هذا جرد ساكن مولّد من نسخة المراجعة الموحدة. يثبت وجود العناصر ومسارات الربط في المصدر، لكنه لا يحل محل اختبارات التشغيل وقاعدة البيانات المبينة في `FIX_REPORT.md`.

## صفحات ومسارات App Router (61)

- `app/account-suspended/page.tsx`
- `app/account/page.tsx`
- `app/account/verify-recovery/page.tsx`
- `app/achievements/page.tsx`
- `app/add/page.tsx`
- `app/admin/[section]/page.tsx`
- `app/admin/audit/[auditId]/page.tsx`
- `app/admin/audit/page.tsx`
- `app/admin/badges/[badgeId]/page.tsx`
- `app/admin/challenges/[challengeId]/page.tsx`
- `app/admin/cms/[contentId]/preview/page.tsx`
- `app/admin/content/[contentId]/edit/page.tsx`
- `app/admin/content/[contentId]/preview/page.tsx`
- `app/admin/content/new/page.tsx`
- `app/admin/error.tsx`
- `app/admin/layout.tsx`
- `app/admin/loading.tsx`
- `app/admin/page.tsx`
- `app/admin/sections/[sectionId]/page.tsx`
- `app/admin/users/[userId]/page.tsx`
- `app/api/activity/route.ts`
- `app/api/admin/media/route.ts`
- `app/api/admin/reports/users.xlsx/route.ts`
- `app/api/admin/reports/users/route.ts`
- `app/api/auth/[...all]/route.ts`
- `app/api/backup-download/route.ts`
- `app/api/files/route.ts`
- `app/api/health/route.ts`
- `app/api/media/[mediaId]/route.ts`
- `app/arabic/page.tsx`
- `app/auth/continue/page.tsx`
- `app/certificates/[id]/page.tsx`
- `app/certificates/verify/[publicId]/page.tsx`
- `app/challenges/page.tsx`
- `app/competitions/page.tsx`
- `app/english/page.tsx`
- `app/error.tsx`
- `app/layout.tsx`
- `app/forgot-password/page.tsx`
- `app/learn/[slug]/page.tsx`
- `app/learn/page.tsx`
- `app/loading.tsx`
- `app/maintenance/page.tsx`
- `app/manifest.ts`
- `app/math/[slug]/page.tsx`
- `app/math/page.tsx`
- `app/not-found.tsx`
- `app/mistakes/page.tsx`
- `app/page.tsx`
- `app/quiz/error.tsx`
- `app/quiz/loading.tsx`
- `app/quiz/page.tsx`
- `app/reset-password/page.tsx`
- `app/results/page.tsx`
- `app/sentences/page.tsx`
- `app/sign-in/page.tsx`
- `app/sign-up/page.tsx`
- `app/sitemap.ts`
- `app/robots.ts`
- `app/study/page.tsx`
- `app/words/page.tsx`

## API Routes (9)

- `app/api/activity/route.ts` — `POST`
- `app/api/admin/media/route.ts` — `GET`، `POST`، `PATCH`، `DELETE`
- `app/api/admin/reports/users.xlsx/route.ts` — `GET`
- `app/api/admin/reports/users/route.ts` — `GET`
- `app/api/auth/[...all]/route.ts` — المعالج مفوض لمكتبة المصادقة
- `app/api/backup-download/route.ts` — `GET`
- `app/api/files/route.ts` — `GET`
- `app/api/health/route.ts` — `GET`
- `app/api/media/[mediaId]/route.ts` — `GET`

## الدوال المصدّرة من ملفات Server Actions (105)

### `app/account/actions.ts`

- `getRecoveryEmailStatus`
- `requestRecoveryEmailVerification`
- `verifyRecoveryEmail`
- `removeRecoveryEmail`
- `requestPasswordReset`
- `consumePasswordReset`

### `app/actions.ts`

- `isAdmin`
- `requireAdmin`
- `getData`
- `getStudioData`
- `getLanguageWords`
- `addWord`
- `updateWord`
- `addBulk`
- `addSentence`
- `toggleFavorite`
- `deleteWord`
- `startWordQuiz`
- `submitWordQuiz`
- `joinChallenge`
- `issueCertificate`
- `getMathSections`
- `getMathQuiz`
- `submitMathQuiz`
- `importMathWorkbook`
- `importMathQuestions`
- `joinCompetition`
- `getCompetitionQuiz`
- `submitCompetition`
- `getCompetitions`
- `getAdminData`
- `createPlatformCategory`
- `updatePlatformCategory`
- `togglePlatformCategory`
- `deletePlatformCategory`
- `toggleUserBan`
- `adminDeleteWord`
- `createMathSection`
- `toggleMathSection`
- `createChallenge`
- `toggleChallenge`
- `deleteChallenge`
- `createMessage`
- `createBanner`

### `app/admin/actions.ts`

- `createEducationalSection`
- `updateEducationalSection`
- `archiveEducationalSection`
- `restoreEducationalSection`
- `createSectionContent`
- `updateSectionContent`
- `duplicateSectionContent`
- `moveSectionContent`
- `restoreSectionContent`
- `changeContentStatus`
- `archiveSectionContent`
- `createLevel`
- `updateLevel`
- `toggleLevel`
- `deleteLevel`
- `createManagedCompetition`
- `updateManagedCompetition`
- `toggleManagedCompetition`
- `deleteManagedCompetition`
- `setCompetitionParticipantStatus`
- `createManagedChallenge`
- `updateManagedChallenge`
- `duplicateManagedChallenge`
- `changeChallengeLifecycle`
- `excludeChallengeParticipant`
- `reinstateChallengeParticipant`
- `approveChallengeWinners`
- `unapproveChallengeResults`
- `updateManagedUserStatus`
- `updateUserRole`
- `bulkUpdateManagedUsers`
- `adjustUserPoints`
- `setUserLevel`
- `addUserAdminNote`
- `recordUserViolation`
- `resetUserProgress`
- `createBadge`
- `updateBadge`
- `archiveBadge`
- `restoreBadge`
- `createAchievement`
- `toggleAchievement`
- `grantUserAchievement`
- `grantUserBadge`
- `revokeUserBadge`
- `createPromotionRule`
- `dryRunPromotionRule`
- `executePromotionRuleBatch`
- `togglePromotionRule`
- `updatePromotionRuleMetadata`
- `duplicatePromotionRule`
- `archivePromotionRule`
- `restorePromotionRule`
- `retryPromotionRuleExecution`
- `upsertSiteContent`
- `restoreSiteContentVersion`
- `setSiteContentStatus`
- `toggleSiteContentVisibility`
- `updatePlatformSettings`

### `app/admin/backup-actions.ts`

- `createBackupDownload`
- `createAndEmailBackup`

## ملفات واجهة تحتوي نماذج أو أزرار (31)

| الملف | النماذج | الأزرار/مكوّنات Button |
|---|---:|---:|
| `app/admin/audit/page.tsx` | 1 | 3 |
| `app/admin/cms/[contentId]/preview/page.tsx` | 0 | 2 |
| `app/admin/content/[contentId]/preview/page.tsx` | 0 | 1 |
| `app/admin/error.tsx` | 0 | 1 |
| `app/admin/sections/[sectionId]/page.tsx` | 0 | 2 |
| `app/error.tsx` | 0 | 1 |
| `app/forbidden.tsx` | 0 | 1 |
| `app/maintenance/page.tsx` | 0 | 1 |
| `app/quiz/error.tsx` | 0 | 2 |
| `components/admin/admin-badge-detail.tsx` | 1 | 3 |
| `components/admin/admin-challenge-detail.tsx` | 0 | 2 |
| `components/admin/admin-console.tsx` | 6 | 26 |
| `components/admin/admin-user-detail.tsx` | 1 | 3 |
| `components/admin/bulk-user-actions.tsx` | 1 | 1 |
| `components/admin/confirmation-dialog.tsx` | 0 | 2 |
| `components/admin/content-editor.tsx` | 1 | 2 |
| `components/admin/managed-action-form.tsx` | 1 | 1 |
| `components/advanced-quiz.tsx` | 1 | 7 |
| `components/app-shell.tsx` | 0 | 3 |
| `components/auth-form.tsx` | 1 | 1 |
| `components/competitions-hub.tsx` | 0 | 2 |
| `components/growth-center.tsx` | 0 | 3 |
| `components/language-hub.tsx` | 1 | 10 |
| `components/math-hub.tsx` | 0 | 5 |
| `components/math-importer.tsx` | 0 | 1 |
| `components/print-certificate-button.tsx` | 0 | 1 |
| `components/recovery-forms.tsx` | 4 | 6 |
| `components/studio.tsx` | 3 | 23 |
| `components/study-session.tsx` | 0 | 9 |
| `components/ui/dialog.tsx` | 0 | 2 |
| `components/ui/sheet.tsx` | 0 | 1 |
