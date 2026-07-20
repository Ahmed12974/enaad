# إصلاح تسجيل الحساب على Vercel

## سبب الخطأ

كان `vercel.json` يشغّل `next build` فقط، لذلك لم تُنفَّذ migrations على قاعدة Neon. نتج عن ذلك الخطأ:

`relation "rateLimit" does not exist (42P01)`

## الإصلاحات

- تشغيل `db:migrate` ثم `db:seed` تلقائيًا قبل البناء على Vercel.
- إضافة migration إصلاحية آمنة لجدول `rateLimit`.
- إضافة `id` عند الإدخال في محدد المعدل المخصص.
- إضافة فحص لوجود جدول `rateLimit` وعمود `id` وفهرس `key` بعد migrations.

## بعد رفع النسخة

يُنفَّذ Redeploy واحد. يجب أن يظهر في Build Logs بالترتيب:

1. `Applied migration ...` أو `Migration ... is already applied.`
2. `Schema validation passed.`
3. `Seed completed successfully.`
4. نجاح `next build` وحالة `Ready`.
