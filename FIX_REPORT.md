# تقرير الدمج والمراجعة الهندسية النهائية


## تحديث Vercel النهائي — 2026-07-24

- أُصلح خطأ TypeScript الخاص بنوع `CompetitionAudience` في موضعي الاستدعاء داخل `app/actions.ts`.
- تم اعتماد مصدر Vercel الذي يستخدم `blobPathname: storedPathname` بدل القيمة `null` التي أوقفت بناء نسخة Netlify.
- أصبح `target` في `tsconfig.json` هو `ES2022`.
- أُعيد تشغيل 37 اختبارًا خالصًا: 37 ناجحًا و0 فاشل.
- أُعيد فحص 54 جدولًا و173 ملف TypeScript/TSX و128 زرًا/عنصر تحكم؛ لم تظهر ملاحظات ساكنة.
- تفاصيل السجلات الحالية في `reports/validation/*-2026-07-24.*` و`FINAL_VERIFICATION_AR.md`.

تاريخ المراجعة: 2026-07-22

## الحكم الصادق

استخدمت `enaad_final_full_repair.zip` كأساس، وفككت النسختين وقارنتهما ملفًا بملف، ثم دمجت التنفيذ الأفضل فقط عندما كان متوافقًا. عُدّل المشروع نفسه ولم يُستبدل بمشروع جديد.

نجحت الفحوص الساكنة والاختبارات الخالصة الممكن تشغيلها داخل بيئة المراجعة. **لم يمكن وصف الإصدار بأنه Production-verified بالكامل** لأن البيئة لم تستطع تنزيل pnpm أو التبعيات من `registry.npmjs.org`، ولا تتوفر فيها قاعدة PostgreSQL تشغيلية أو حسابات Vercel Blob وResend أو متصفح Playwright. لذلك تم وسم هذه البنود بأنها متعذرة تقنيًا بدل اختلاق نجاحها.

## مقارنة النسختين

| البند | النسخة الأولى | النسخة الأساسية | النسخة الموحدة قبل التغليف النهائي |
|---|---:|---:|---:|
| عدد الملفات | 216 | 222 | يتضمن الإصلاحات والتقارير الجديدة |
| ملفات موجودة في الأولى فقط | 6 | — | دُمج المفيد منها وظيفيًا دون نسخ فروع migrations المتعارضة |
| ملفات موجودة في الأساسية فقط | — | 12 | احتُفظ بالتنفيذ الأقوى مثل تشفير النسخ وسياسة المنافسات والأخطاء العامة |
| ملفات مشتركة مختلفة | 56 | 56 | روجعت انتقائيًا بدل الاستبدال الأعمى |

تفاصيل المقارنة الآلية موجودة في `reports/validation/comparison-summary.json`.

### قرارات الدمج المهمة

- لم تُنسخ migrations الأولى `0014_competition_math_sections` و`0015_section_localization_and_activation` و`0016_competition_coin_rewards` فوق السلسلة الأساسية؛ لأنها تحمل أرقامًا وفروعًا متعارضة. احتُفظ بالسلسلة الأساسية وأضيفت `0017_branch_compatibility.sql` لتحويل قواعد البيانات التي مرّت بالفرع البديل دون حذف بياناتها.
- احتُفظ بـ`lib/backup-crypto.ts` من النسخة الأساسية لأنه يستخدم `scrypt` و`AES-256-GCM` بدل اشتقاق أضعف للمفتاح.
- نُقلت فكرة أداة التحقق المستقلة من النسخة الأولى، ثم رُبطت بمدقق الأرشيف الأقوى في النسخة الأساسية عبر `scripts/verify-backup.ts` و`lib/backup-verification.ts`.
- احتُفظ بسياسات المنافسات والأخطاء العامة وعزل الأقسام الموجودة في النسخة الأساسية، ودُمجت تحسينات صفحة خطأ الاختبار وبعض أدوات النسخ من النسخة الأولى بعد المراجعة.
- حُذف `components/ui/chart.tsx` لأنه غير مستخدم وكان الموضع الوحيد الذي يستخدم `dangerouslySetInnerHTML`.

## أهم الأسباب الجذرية التي اكتُشفت وأُصلحت

1. **تهيئة المدير كانت مرتبطة بقراءة الجلسة:** كان من الممكن إعادة ترقية الحساب عند فتح صفحة أو قراءة session. أزيل الاستدعاء من `getCurrentUser()` وأصبحت التهيئة أمرًا صريحًا لمرة واحدة بعلامة دائمة داخل `platformSettings`.
2. **فروع migrations متعارضة:** النسختان استخدمتا الأرقام نفسها لتعريفات مختلفة للأقسام والمنافسات. أضيفت migration توافق غير مدمرة وتحقق بعد التنفيذ.
3. **مرجع حقل غير موجود:** إجراء تعطيل المستوى كان يكتب إلى `levels.lifecycle` غير الموجود في المخطط. أزيل المرجع، وأضيف مدقق مصدر يقارن استعمال الحقول بجدول Drizzle.
4. **الملفات العامة كانت تُحجب قبل وصولها للمسار:** `proxy.ts` كان يطلب cookie على `/api/files` رغم أن المسار يدعم البنرات العامة. أصبح المسار يمر إلى التفويض الدقيق داخله؛ البنرات النشطة عامة والشهادات تبقى للمالك أو المدير.
5. **صفحة الإنجازات لم تعرض الإنجازات:** كانت تستخدم واجهة التحديات فقط. أصبحت تجلب الإنجازات والشارات الحقيقية وحالة اكتساب المستخدم وتعرضها بنصوص عربية بدل القيم التقنية.
6. **بيانات metadata الوهمية:** كان `layout` و`sitemap` يرجعان نطاقات placeholder عند نقص عنوان التطبيق. أزيل fallback الوهمي، وأصبحت بيئة الإنتاج تفشل بوضوح عند غياب origin صالح.
7. **رسائل استثناء قد تصل إلى واجهة الاختبار:** استُبدل عرض `error.message` المباشر في اختبارات الكلمات والرياضيات بمصفاة أخطاء عامة عربية.
8. **استعلامات صفحات التحديات كانت تجلب كلمات وجمل واختبارات لا تستخدمها:** قُصرت البيانات على التحديات والتقدم والشهادات والإنجازات والشارات، وقُيدت المشاركات بالتحديات الظاهرة فقط.
9. **تغيير أدوار المديرين دون حارس المدير الأخير:** أضيف قفل ومعاملة وإعادة تحقق من دور المنفذ داخل المعاملة، ومنع تخفيض أو تعطيل آخر مدير نشط ومنع self-demotion.
10. **منح الإنجاز كان يحدّث الرصيد يدويًا دون دورة المكافآت الموحدة:** أصبح يستخدم `awardProgress` حتى تُطبق idempotency ومزامنة المستوى وقواعد الترقية والشارات.
11. **إخفاء قائمة الإدارة على الهاتف:** أصبح شريط الإدارة أفقيًا قابلًا للتمرير، ولا يُخفى إلا sidebar الخارجي المقصود، مع padding سفلي يحمي الأزرار من شريط التنقل الثابت.
12. **حقول بلا أسماء وصول واضحة:** أضيفت أسماء وصول للحقول التي اعتمدت على placeholder فقط، وأضيف مدقق مصدر يمنع تكرار المشكلة.
13. **مخاطر النسخة الناقصة أو الملف اليتيم:** يُفتح ZIP ويُراجع قبل النجاح، وتُفحص أعداد الجداول وSHA-256 وملفات Blob، ويُنظف Blob المرفوع عند فشل التسليم قبل إنشاء رابط صالح.
14. **نجاح بريد وهمي:** لا تُعتبر رسالة النسخة مرسلة إلا عند وجود معرّف قبول من Resend. إذا قبل المزود الرسالة ثم فشل تحديث السجل الداخلي، لا تُحذف النسخة ولا يُدّعى أن المزود فشل؛ يرجع نجاح مع تحذير صريح عن bookkeeping.

## تهيئة المدير الأولى

- المتغير `INITIAL_ADMIN_EMAIL` مدخل bootstrap فقط وليس قاعدة صلاحيات دائمة.
- يجب أن يكون الحساب موجودًا، مؤكد البريد، غير محظور وغير محذوف.
- التهيئة تُنفذ فقط من `pnpm admin:bootstrap` أو `pnpm db:seed`.
- تستخدم العلامة `security.initial-admin-bootstrap.v1` و`ON CONFLICT DO NOTHING` لمنع سباق طلبين.
- بعد استهلاك العلامة لا يمكن لتغيير المتغير أو تشغيل seed إعادة ترقية حساب خُفضت صلاحيته.
- المصدر الدائم للصلاحية هو `user.role` وحالة الحساب في قاعدة البيانات.
- لا يوجد بريد مدير ثابت داخل المصدر.

## مصفوفة التتبع

| رقم | المتطلب/المشكلة | الدليل أو الاختبار | النتيجة | الحالة |
|---|---|---|---|---|
| REQ-001 | مقارنة الملفين وعدم النسخ الأعمى | مقارنة SHA-256 وبنية الملفات | 216 مقابل 222 و56 ملفًا مشتركًا مختلفًا | تم التحقق منه |
| REQ-002 | عدم تهيئة المدير أثناء قراءة session | `source-security.test.ts` وفحص `auth-session.ts` | لا يوجد استدعاء bootstrap في مسار الجلسة | تم التحقق منه |
| REQ-003 | bootstrap لمرة واحدة ومتزامن | `admin-bootstrap.test.ts` موجود | الاختبار التشغيلي يتطلب PGlite غير المثبت | متعذر تقنيًا: التبعيات غير متاحة |
| REQ-004 | منع إعادة الترقية بعد التخفيض | marker دائم واختبار تكامل موجود | المصدر يرفض إعادة التنفيذ | تم التحقق منه ساكنًا؛ تكامل DB متعذر |
| REQ-005 | صلاحيات الإدارة من DB | اختبارات سياسة المدير الخالصة | 2/2 ناجحة | تم التحقق منه |
| REQ-006 | منع آخر مدير من التخفيض/التعطيل | فحص إجراءات المستخدمين والقفل | حارس داخل transaction وقفل advisory | تم التحقق منه ساكنًا؛ concurrency DB متعذر |
| REQ-007 | توافق فرعي migrations | اختبار source و`0017_branch_compatibility.sql` | يحفظ `nameAr` ويطبع القيم إلى النموذج الموحد | تم التحقق منه ساكنًا؛ PostgreSQL متعذر |
| REQ-008 | تطابق حقول Drizzle | `pnpm audit:schema` مباشرة عبر Node | 54 جدولًا، 1502 مرجعًا، 224 عملية كتابة، 0 finding | تم التحقق منه |
| REQ-009 | خطأ حقل المستوى غير الموجود | مدقق المخطط وفحص المصدر | لا يوجد استعمال `levels.lifecycle` | تم التحقق منه |
| REQ-010 | المصادقة والجلسات وBetter Auth | اختبارات integration موجودة | لم يمكن تشغيل خدمة DB أو الحزم | متعذر تقنيًا |
| REQ-011 | حماية المستخدم العادي من الإدارة | policy tests + تفويض server actions | المسارات والإجراءات تتحقق على الخادم | تم التحقق ساكنًا؛ E2E متعذر |
| REQ-012 | CRUD الأقسام الديناميكية | source tests ومخطط/migrations | واجهة وإجراءات وقيود slug/name/status موجودة | تم التحقق ساكنًا؛ CRUD DB متعذر |
| REQ-013 | المستويات والترقيات | فحص schema/actions/rewards | قيود non-negative وunique ومزامنة المستوى | تم التحقق ساكنًا؛ DB متعذر |
| REQ-014 | التحديات والمكافأة مرة واحدة | ledger فريد ومعاملات | المصدر يمنع المكافأة المكررة | تم التحقق ساكنًا؛ concurrency متعذر |
| REQ-015 | المنافسات منفصلة ودورة زمنية | `competition-policy.test.ts` | 3/3 ناجحة | تم التحقق من السياسة |
| REQ-016 | أسئلة المنافسة من المجموعة الصادرة | فحص source لمحاولات وأسئلة participant | client لا يرسل score موثوقًا | تم التحقق ساكنًا؛ تكامل DB متعذر |
| REQ-017 | محرك اختبارات الكلمات | `quiz-engine.test.ts` | 5/5 ناجحة | تم التحقق منه |
| REQ-018 | منع عرض استثناءات حساسة | `public-error.test.ts` واختبار source | 2/2 ناجحة والعملاء يستخدمون المصفاة | تم التحقق منه |
| REQ-019 | صفحة خطأ الاختبار العربية | فحص `app/quiz/error.tsx` | retry وعودة ورسالة آمنة | تم التحقق ساكنًا؛ إعادة إنتاج digest متعذر |
| REQ-020 | صفحة الإنجازات والشارات | source-security test | بيانات DB وحالة الاكتساب معروضة | تم التحقق ساكنًا؛ E2E متعذر |
| REQ-021 | الملفات العامة والخاصة | source-security test + إصلاح proxy | banner العام يصل للمسار، certificate owner/admin | تم التحقق ساكنًا؛ Blob متعذر |
| REQ-022 | رفع الوسائط الآمن | magic bytes/limits/random path/audit | لا توجد نجاحات صامتة في cleanup | تم التحقق ساكنًا؛ Blob متعذر |
| REQ-023 | النسخة تحتوي بيانات حقيقية | اختبارات الأرشيف والمصدر | الجداول التشغيلية وBlob والmanifest إلزامية | تم التحقق من المنطق؛ بيئة الإنتاج متعذرة |
| REQ-024 | سلامة ZIP وSHA-256 | `backup-archive.test.ts` | 7/7 ناجحة | تم التحقق منه |
| REQ-025 | تشفير بيانات الاعتماد | اختبار مفتاح صحيح وخاطئ | AES-256-GCM ورفض السر الخاطئ | تم التحقق منه |
| REQ-026 | الاستعادة إلى DB وBlob | أداة restore وفحص source | تحقق counts وself references موجود | متعذر تقنيًا: لا PostgreSQL/Blob |
| REQ-027 | إرسال Resend أو رابط مؤقت | فحص provider ID والمسار الموقّع | التنفيذ موجود ولا يعيد نجاحًا ثابتًا | متعذر تقنيًا: لا حساب Resend/Blob |
| REQ-028 | حماية رابط النسخة | HMAC/TTL/path validation/private cache | اختبار source ناجح | تم التحقق ساكنًا |
| REQ-029 | واجهة الهاتف وRTL | CSS/source test | breakpoints 760/430، scroll وsafe-area | تم التحقق ساكنًا؛ متصفح متعذر |
| REQ-030 | أسماء الحقول وقابلية الوصول | `audit:a11y` | 0 finding | تم التحقق منه ساكنًا |
| REQ-031 | منع النص العربي المشوه | اختبار مسح Unicode | 0 replacement character | تم التحقق منه |
| REQ-032 | عدم وجود أسرار أو بريد شخصي | source-security test ومسح الملفات | لا `.env` حقيقي ولا عنوان شخصي | تم التحقق منه |
| REQ-033 | عدم وجود TODO/تعطيل أدوات الجودة | مسح المصدر | 0 TODO/FIXME/ts-ignore/eslint-disable | تم التحقق منه |
| REQ-034 | عدم وجود HTML ديناميكي خطر | مسح المصدر وحذف chart غير المستخدم | 0 `dangerouslySetInnerHTML`/eval/new Function | تم التحقق منه |
| REQ-035 | تقليل over-fetch في صفحات النمو | source-security test | لا تجلب كلمات/جمل/اختبارات غير مستخدمة | تم التحقق منه |
| REQ-036 | origin صحيح للـmetadata والسitemap | source-security test | لا نطاق placeholder في الإنتاج | تم التحقق منه |
| REQ-037 | `pnpm install --frozen-lockfile` | محاولة فعلية محفوظة | فشل `EAI_AGAIN registry.npmjs.org` قبل التثبيت | متعذر تقنيًا |
| REQ-038 | lint/typecheck/full test/build | تعتمد على التثبيت | لم تُشغّل ولم يُدّع نجاحها | متعذر تقنيًا |
| REQ-039 | E2E هاتف/مستخدم/مدير | Playwright والتطبيق وDB مطلوبون | ملفات الاختبارات موجودة، التشغيل غير ممكن | متعذر تقنيًا |
| REQ-040 | نشر Vercel الحقيقي | يحتاج حساب المشروع وأسراره | لم يُنفذ من بيئة المراجعة | متعذر تقنيًا |

## الاختبارات والفحوص التي شُغلت فعليًا

### اختبارات Node الخالصة والساكنة

شُغلت 7 ملفات اختبار يمكن تشغيلها دون تثبيت المشروع الكامل:

```text
suites: 7
tests: 37
pass: 37
fail: 0
cancelled: 0
skipped: 0
```

تغطي سلامة ZIP والتشفير، سياسة المنافسات، سياسة المدير، محرك الاختبارات، رسائل الخطأ، المتطلبات الإدارية، وحراس المصدر والأمان. السجل الكامل في `reports/validation/pure-tests.log`.

### فحوص المصدر

```text
TypeScript/TSX syntax audit: 0 errors
Static AST audit: 177 files, 0 findings
Local import audit: 786 imports
Missing local imports: only .next/types/routes.d.ts, وهو ملف يولده Next أثناء البناء
Drizzle schema audit: 54 tables, 1502 references, 224 writes, 0 findings
Accessibility source audit: 0 findings
package.json / pnpm-lock importer consistency: 0 issues
```

السجلات موجودة داخل `reports/validation/`.

## الأوامر التي تعذر تشغيلها

المحاولة الفعلية:

```bash
rm -rf node_modules .next
corepack pnpm@10.28.2 install --frozen-lockfile
```

انتهت قبل تنزيل pnpm بسبب:

```text
getaddrinfo EAI_AGAIN registry.npmjs.org
```

لذلك لم تُشغّل بصدق:

```text
pnpm lint
pnpm typecheck
pnpm test بصيغته الكاملة
pnpm build
pnpm test:e2e
مهاجرات PostgreSQL على قاعدة حقيقية
رحلة Better Auth كاملة
استعادة backup إلى PostgreSQL
تنزيل/رفع Vercel Blob الحقيقي
إرسال Resend الحقيقي
نشر Vercel الحقيقي
```

## الملفات المحورية المعدلة أو المضافة

- المدير والمصادقة: `lib/admin-bootstrap.ts`, `lib/admin-policy.ts`, `lib/auth-session.ts`, `scripts/promote-admin.ts`, `scripts/seed.ts`, `scripts/verify-release.ts`.
- الأدوار والإدارة: `app/admin/actions.ts`, `components/admin/admin-user-detail.tsx`, `components/admin/bulk-user-actions.tsx`.
- قاعدة البيانات: `drizzle/0017_branch_compatibility.sql`, `scripts/migrate.mjs`, `scripts/audit-schema-source.cjs`.
- الاختبارات والتقدم: `app/actions.ts`, `components/advanced-quiz.tsx`, `components/math-hub.tsx`, `components/growth-center.tsx`, `app/achievements/page.tsx`.
- الملفات والوسائط: `proxy.ts`, `app/api/files/route.ts`, `app/api/admin/media/route.ts`.
- النسخ: `app/admin/backup-actions.ts`, `app/api/backup-download/route.ts`, `lib/backup-verification.ts`, `lib/zip-archive.ts`, `scripts/verify-backup.ts`, `scripts/restore-backup.ts`.
- الواجهة: `app/globals.css` وعدة مكونات إدارة، `scripts/audit-accessibility-source.cjs`.
- الإعداد والنشر: `app/layout.tsx`, `app/sitemap.ts`, `.env.example`, `vercel.json`, `.github/workflows/ci.yml`.
- التوثيق: `README.md`, `SECURITY.md`, `INVENTORY.md`, `FIX_REPORT.md`.

## التحقق المطلوب على بيئة متصلة قبل تسمية الإصدار Production-verified

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm db:seed
pnpm lint
pnpm audit:schema
pnpm audit:a11y
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

ثم يجب تشغيل رحلة مستخدم ومدير على قاعدة اختبار، وإنشاء backup حقيقي، وتشغيل `pnpm backup:verify` ثم `pnpm backup:restore -- --verify-only` والاستعادة على قاعدة فارغة، واختبار Resend وVercel Blob بمفاتيح بيئة خارج المصدر.
