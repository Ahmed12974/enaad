# أكاديمية زايد التعليمية

منصة تعليمية عربية مبنية باستخدام **Next.js App Router وReact وTypeScript وPostgreSQL وDrizzle ORM وBetter Auth**. تشمل إدارة الكلمات والعبارات والدراسة والاختبارات والتحديات والمنافسات والأقسام التعليمية والمستويات والشارات ومحتوى الواجهة والنسخ التشغيلية.

## المتطلبات

- Node.js 22.x
- pnpm 10.28.2
- PostgreSQL حديث يدعم `gen_random_uuid()`
- حساب Vercel للنشر الاختياري
- Vercel Blob عند استخدام الوسائط والنسخ التشغيلية
- Resend عند استخدام التحقق بالبريد والاسترداد وإرسال النسخ

## إعداد البيئة

انسخ ملف المثال دون وضع الأسرار في Git:

```bash
cp .env.example .env.local
```

أهم المتغيرات:

```dotenv
DATABASE_URL=postgresql://user:password@host:5432/database
BETTER_AUTH_SECRET=replace-with-a-stable-random-secret-at-least-32-characters
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
AUTH_TRUSTED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000

RESEND_API_KEY=
EMAIL_FROM=Academy <onboarding@resend.dev>

BLOB_READ_WRITE_TOKEN=
BACKUP_RECIPIENT_EMAIL=
BACKUP_ENCRYPTION_SECRET=

INITIAL_ADMIN_EMAIL=
```

ملاحظات مهمة:

- استخدم قيمة ثابتة قوية لـ`BETTER_AUTH_SECRET` في كل نشرات الإنتاج.
- `EMAIL_FROM` هو عنوان **المرسل** في Resend، وليس بريد الاستقبال. استخدم نطاقًا موثّقًا للإرسال العام.
- `BACKUP_RECIPIENT_EMAIL` اختياري؛ عند غيابه يستخدم النظام بريد المدير الحالي الذي طلب النسخة.
- `BACKUP_ENCRYPTION_SECRET` مستقل عن سر المصادقة، وطوله 32 حرفًا على الأقل.
- `INITIAL_ADMIN_EMAIL` إدخال bootstrap اختياري لمرة واحدة؛ لا يمنح الإدارة إلا لحساب موجود ومؤكد البريد. المصدر الدائم للصلاحية هو الدور المخزن في قاعدة البيانات.
- لا تفعّل `ALLOW_BACKUP_RESTORE` في التطبيق الطبيعي أو في إنتاج حي.

## التشغيل المحلي

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm db:seed
pnpm dev
```

افتح `http://localhost:3000`.

## إنشاء المدير الأول

1. أنشئ الحساب بالطريقة الرسمية من واجهة التسجيل.
2. أكّد البريد إذا كان التحقق مفعّلًا.
3. اضبط `INITIAL_ADMIN_EMAIL` على البريد نفسه مؤقتًا.
4. شغّل أحد الخيارين:

```bash
pnpm admin:bootstrap
# أو شغّل seed الآمن بعد إنشاء الحساب وتأكيده
pnpm db:seed
```

5. بعد نجاح التهيئة، تُحفظ علامة دائمة داخل `platformSettings` تمنع إعادة التهيئة. يمكنك بعدها ترك المتغير فارغًا. قراءة الجلسة لا تستدعي bootstrap، وأي تخفيض لاحق للدور يظل محفوظًا ولا يعيده `seed`. الدخول الإداري يعتمد فقط على الدور وحالة الحساب في قاعدة البيانات.

## قاعدة البيانات والمهاجرات

```bash
pnpm db:migrate
pnpm db:seed
```

- المهاجرات داخل `drizzle/` وتُنفذ بترتيبها.
- مشغل المهاجرات يستخدم قفل PostgreSQL ومعاملة وبصمات للملفات المنفذة.
- المهاجرة `0017_branch_compatibility.sql` توحّد بأمان قواعد بيانات مرت عليها سلسلة المهاجرات البديلة القديمة، وتحافظ على أسماء الأقسام العربية والبيانات بدل حذفها.
- `seed` قابل لإعادة التشغيل، ولا يحذف بيانات المستخدمين.
- لا تستخدم `drop` أو reset على قاعدة الإنتاج.

## الاختبارات والجودة

```bash
pnpm lint
pnpm audit:schema
pnpm audit:a11y
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

تحتاج اختبارات التكامل وقاعدة البيانات إلى بيئة PostgreSQL/PGlite والتبعيات المثبتة. تحتاج اختبارات E2E إلى متصفح Playwright وبيئة اختبار معزولة.

## الوظائف الإدارية

المسار `/admin` محمي على الخادم. المستخدم العادي لا يستطيع فتح الصفحات أو استدعاء إجراءات الإدارة حتى لو عرف الرابط.

تشمل لوحة التحكم:

- الإحصائيات والمستخدمين.
- الأقسام التعليمية الديناميكية ومحتواها.
- المستويات وقواعد الترقية والشارات والإنجازات.
- التحديات والمنافسات وإدارة المشاركين.
- محتوى واجهة الموقع والوسائط.
- سجل العمليات الإدارية.
- إنشاء وتنزيل وإرسال النسخ التشغيلية.

صفحات الإدارة تحمل تعليمات `noindex` و`nofollow` لمنع فهرستها. تغيير أدوار المديرين يُنفذ بقفل ومعاملة، ويُمنع تعطيل أو تخفيض آخر مدير نشط.

## النسخ التشغيلية والاستعادة

زر النسخ في لوحة التحكم ينشئ **نسخة بيانات وملفات تشغيلية**، وليس نسخة من مستودع Git.

الأرشيف يحتوي على:

- `database.json`: الجداول التشغيلية المسموح بها وأعداد السجلات.
- `auth-credentials.enc.json`: تجزئات بيانات دخول Better Auth اللازمة للاستعادة داخل ملف AES-256-GCM مشفر.
- `manifest.json`: الإصدار والأعداد والأحجام وبصمات SHA-256.
- `blobs/`: ملفات Vercel Blob الحقيقية عند وجودها.
- `RESTORE_AR.md`: تعليمات الاستعادة المطابقة للأرشيف.

لا تتضمن النسخة الجلسات أو رموز التحقق والاسترداد أو مفاتيح البيئة أو OAuth tokens. يوقف المنشئ العملية بدل إنتاج نجاح ناقص إذا تجاوز مجموع بيانات المصدر والملفات الحد الوقائي الحالي البالغ 60 MB؛ هذا الحد يمنع استهلاك ذاكرة وظيفة الخادم بصورة غير منضبطة ويجب مراجعته مع نقل التنفيذ إلى عامل streaming عند نمو البيانات.

للتحقق المستقل من سلامة الأرشيف فقط:

```bash
pnpm backup:verify -- ./backup.zip
```

ولفحص الأرشيف من أداة الاستعادة دون إدخال بيانات:

```bash
pnpm backup:restore -- ./backup.zip --verify-only
```

للاستعادة إلى قاعدة **فارغة ومعزولة**:

```bash
export ALLOW_BACKUP_RESTORE=EMPTY_TEST_DATABASE
export DATABASE_URL=postgresql://...
export BACKUP_ENCRYPTION_SECRET=...
pnpm backup:restore -- ./backup.zip --apply
```

ولإعادة ملفات Blob أيضًا:

```bash
export BLOB_READ_WRITE_TOKEN=...
pnpm backup:restore -- ./backup.zip --apply --restore-blobs
```

الأداة ترفض الدمج في قاعدة تحتوي بيانات تشغيلية، وتستعيد قاعدة البيانات داخل معاملة واحدة، ثم تتحقق من الأعداد بعد الإدخال. استعادة PostgreSQL وVercel Blob ليست معاملة موزعة واحدة؛ عند استخدام `--restore-blobs` قد تنجح قاعدة البيانات ثم يفشل رفع ملف خارجي، ولذلك نفّذ الاستعادة في بيئة معزولة وراجع سجل الملفات قبل تحويل المرور إليها.

## النشر على Vercel

1. ارفع المشروع إلى GitHub دون `.env.local` أو أسرار.
2. اربط المستودع بـVercel.
3. أضف متغيرات البيئة في Settings → Environment Variables.
4. اجعل Root Directory هو مجلد المشروع الذي يحتوي `package.json`.
5. أمر البناء الموجود في `vercel.json` ينفذ المهاجرات ثم seed الآمن ثم فحص الإصدار ثم البناء.

قبل النشر الإنتاجي، شغّل أوامر الجودة محليًا أو في CI على نسخة نظيفة. لا تجعل seed وسيلة لإعادة تهيئة بيانات الإنتاج.

## هيكل مختصر

```text
app/                 صفحات App Router وServer Actions وAPI Routes
components/          واجهات المستخدم ولوحة التحكم
lib/                 المصادقة وقاعدة البيانات والأمان ومنطق الأعمال
lib/db/schema.ts     مخطط Drizzle
Drizzle/             المهاجرات (المجلد الفعلي اسمه drizzle)
scripts/             migrate/seed/diagnostics/restore
Tests/               اختبارات Node وPlaywright (المجلد الفعلي اسمه tests)
public/              الأصول العامة
```

## التوثيق الأمني وتقرير الإصلاح

- راجع `SECURITY.md` لسياسات الأمان والتعامل مع الثغرات.
- راجع `FIX_REPORT.md` لمصفوفة المتطلبات والتعديلات ونتائج التحقق التي شُغّلت فعليًا والاختبارات التي تعذر تشغيلها في بيئة التسليم.
