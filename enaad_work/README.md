# لُغتي

منصة Next.js تستخدم Better Auth وPostgreSQL. تتضمن هذه النسخة إعداد مصادقة موحدًا، مخطط قاعدة بيانات قابلًا للترحيل، صلاحيات مبنية على الأدوار، ومحاولات اختبار ومكافآت ذرية لا تثق بنتيجة المتصفح.

## المتطلبات

- Node.js 22 مطلوب للنشر (`22.x`) لضمان نفس بيئة Vercel والتطوير المحلي.
- pnpm `10.28.2`، وهو مثبت في `packageManager`.
- PostgreSQL 16 موصى به.


## نشر Vercel: تنبيه مهم لرفع الملفات

يجب رفع **المشروع كاملًا** إلى GitHub، وليس الملفات الموجودة في الجذر فقط. قبل ربطه بـVercel،
يجب أن يظهر في مستودع GitHub كل من المجلدات التالية: `app`, `components`, `drizzle`, `lib`,
`public`, `scripts`, `tests`، بجانب `package.json`. إذا غاب مجلد `scripts` أو `app` فسيفشل
البناء. أمر البناء المبسط هو `next build --webpack` ولا يعتمد على ملف preload مخصص.

## تشغيل بيئة التطوير

```bash
corepack enable
corepack prepare pnpm@10.28.2 --activate
pnpm install --frozen-lockfile
cp .env.example .env.local
```

حرر `.env.local` واضبط على الأقل `DATABASE_URL` و`BETTER_AUTH_SECRET`. أنشئ السر مرة واحدة واحتفظ بالقيمة نفسها بين عمليات النشر:

```bash
openssl rand -base64 32
```

إعداد localhost المعتاد هو:

```dotenv
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
AUTH_TRUSTED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

ثم شغّل:

```bash
pnpm db:migrate
pnpm db:seed
pnpm auth:diagnose --self-test
pnpm dev
```

افتح `http://localhost:3000/sign-up` وأنشئ حسابًا من الواجهة الرسمية، ثم اختبر الخروج وإعادة الدخول والصفحات المحمية.

## إعداد الإنتاج

- اجعل `BETTER_AUTH_URL` و`NEXT_PUBLIC_APP_URL` نفس الـOrigin العام الدقيق باستخدام HTTPS، من دون مسار أو wildcard.
- ضع فقط Origins الفعلية في `AUTH_TRUSTED_ORIGINS`، مفصولة بفواصل.
- لا تضف `www` إلا إذا كان التطبيق يُخدم عليه فعلًا. اختر عنوانًا أساسيًا واحدًا وحوّل الآخر إليه.
- لا تُشتق الثقة من `x-forwarded-host` أو `x-forwarded-proto`. العنوان العام الثابت هو المرجع. اضبط `AUTH_TRUSTED_PROXIES` فقط إذا كان خادم الأصل لا يقبل المرور إلا من تلك الوكلاء.
- لا تضبط Domain للـCookie دون حاجة. Better Auth يصدر Cookie مضيفة النطاق؛ `Secure` يعمل تلقائيًا على HTTPS فقط، و`SameSite=Lax` و`HttpOnly` محفوظان.
- اضبط `RESEND_API_KEY` و`EMAIL_FROM` لتفعيل رسالة تأكيد البريد الرسمية ورسائل الاسترداد.
- اضبط `BLOB_READ_WRITE_TOKEN` لملفات البانرات والشهادات الخاصة.

يفشل البناء مبكرًا إذا كان عنوان الإنتاج غير HTTPS أو كان سر Better Auth مفقودًا/قصيرًا.

## قاعدة البيانات والترحيلات

نفّذ قبل تشغيل إصدار التطبيق:

```bash
pnpm db:migrate
pnpm db:seed
```

يكتشف مشغل الترحيلات تلقائيًا قاعدة جديدة أو مخطط المشروع القديم. القاعدة الجديدة تبدأ
بـ`0000`–`0002`، بينما المخطط القديم يمر أولًا عبر
`drizzle/legacy/0001_secure_upgrade.sql`. بعد ذلك يطبق المشغل، بالترتيب وداخل معاملات
منفصلة مع checksum وقفل استشاري، جميع الترحيلات `0003`–`0010`، ثم يتحقق من الجداول
والأعمدة الحرجة. لا تعدّل أي ترحيل طُبق سابقًا؛ أضف ترحيلًا تصحيحيًا جديدًا.

الترحيل القديم يفحص تكرار البريد بعد التطبيع والبيانات غير الصالحة والعلاقات اليتيمة. عند وجود تعارض يتوقف من دون حذف حساب أو إعادة تعيين كلمة مرور. خذ Snapshot من مزود PostgreSQL قبل الترحيل، وشغله أولًا على نسخة مرحلية من بيانات الإنتاج.

## إنشاء المدير

أنشئ الحساب بالطريقة الرسمية من `/sign-up` ثم أكد البريد. بعد ذلك، من بيئة الخادم:

```bash
pnpm admin:promote enaadx@gmail.com
```

إذا كانت خدمة البريد غير مهيأة لكن المشغل تحقق من ملكية البريد خارج التطبيق، يلزم تصريح صريح ويُسجل في Audit Log:

```bash
pnpm admin:promote enaadx@gmail.com
```

البريد الوحيد المسموح به إداريًا هو `enaadx@gmail.com`. لا يكفي الدور وحده: كل صفحة
وAction وAdmin API تتحقق على الخادم من البريد بعد التطبيع، وتوثيقه، والدور، وعدم الحظر أو
التعطيل، وسجل `adminAllowlist` النشط. لا يقبل الخادم هوية المدير أو دوره من العميل.

## تشخيص المصادقة بأمان

```bash
pnpm auth:diagnose
pnpm auth:diagnose --self-test
```

تفحص الأداة الاتصال، وجداول وأعمدة Better Auth، وتطبيع البريد، والتكرار، وربط حساب `credential`، وشكل الـHash، والعلاقات اليتيمة. خيار `--self-test` ينشئ حسابًا مؤقتًا بالطريقة الرسمية، ويختبر Cookie والجلسة والدخول والخروج ثم يحذفه. لا تطبع الأداة كلمة مرور أو Session Token أو Secret أو Hash كاملًا.

## بوابة الجودة

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm audit --prod
```

اختبار المتصفح يحتاج PostgreSQL مهيأة وChromium. اضبط العلم التالي فقط في قاعدة اختبار
معزولة للسماح للاختبار بإنشاء حالات الصلاحية الإدارية المؤقتة:

```bash
pnpm exec playwright install chromium
E2E_ALLOW_ADMIN_FIXTURE=1 pnpm test:e2e
```

يشغّل Playwright المسارات نفسها على Desktop Chrome ومحاكاة Pixel 7، ويغطي حالات
التفويض الست، وإنشاء قسم ومحتوى بمتطلب سابق ومنع الدورة، ونشر CMS، وDry Run لقواعد
الترقية، وتصدير CSV الآمن، ورفض ملف تنفيذي، والتأثير الفعلي لإعدادات التسجيل والصيانة
واسم الموقع وحد الرفع. ملف CI في `.github/workflows/ci.yml` يشغل PostgreSQL 16
والترحيلات والبناء واختبارات المتصفح.

## ملاحظات تشغيلية

- تبويب تصدير البيانات الإداري ليس بديلًا عن نسخة PostgreSQL مشفرة أو Point-in-Time Recovery، ولا يشمل محتوى Blob. استخدم نسخ مزود PostgreSQL وBlob واختبر الاستعادة دوريًا.
- تقارير المستخدمين والوسائط تستخدم Pagination وفلاتر مركبة وترتيبًا بقائمة أعمدة
  مسموحة، وتصدر CSV/XLSX وفق الفلاتر الحالية مع منع Spreadsheet Formula Injection.
- تتبع مدة الاستخدام يبدأ من أول نشر لهذه النسخة ولا يخترع بيانات تاريخية.
- لا تنشر قبل نجاح Playwright على بيئة مطابقة للإنتاج وتشغيل الترحيل على نسخة من قاعدة البيانات الحقيقية.

راجع `ADMIN_FINAL_ACCEPTANCE.md` و`ADMIN_DASHBOARD_REPORT.md` للنتائج الفعلية وحدود
التحقق، و`AUTH_REMEDIATION_REPORT.md` لتفاصيل المصادقة.
