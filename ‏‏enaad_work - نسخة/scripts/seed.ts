import { pool, db } from '@/lib/db'
import { and, eq, sql } from 'drizzle-orm'
import {
  achievements,
  adminAllowlist,
  auditLogs,
  categories,
  educationalSections,
  encouragementMessages,
  levels,
  mathSections,
  user,
} from '@/lib/db/schema'
import { SOLE_ADMIN_EMAIL } from '@/lib/admin-policy'

async function seed() {
  await db.transaction(async (tx) => {
    await tx
      .insert(adminAllowlist)
      .values({ email: SOLE_ADMIN_EMAIL, role: 'SUPER_ADMIN', isActive: true })
      .onConflictDoUpdate({
        target: adminAllowlist.email,
        set: { role: 'SUPER_ADMIN', isActive: true, updatedAt: new Date() },
      })

    const [adminAccount] = await tx
      .select({ id: user.id, role: user.role, emailVerified: user.emailVerified })
      .from(user)
      .where(
        and(
          sql`lower(trim(${user.email})) = ${SOLE_ADMIN_EMAIL}`,
          eq(user.emailVerified, true),
          sql`${user.deletedAt} is null`,
        ),
      )
      .limit(1)
    if (adminAccount && adminAccount.role !== 'admin') {
      await tx.update(user).set({ role: 'admin', updatedAt: new Date() }).where(eq(user.id, adminAccount.id))
      await tx.insert(auditLogs).values({
        actorUserId: adminAccount.id,
        action: 'bootstrap_admin',
        entityType: 'user',
        entityId: adminAccount.id,
        before: { role: adminAccount.role },
        after: { role: 'admin', allowlistedEmail: SOLE_ADMIN_EMAIL },
        reason: 'Secure seed promoted the verified sole administrator account.',
      })
    }

    await tx
      .insert(levels)
      .values([
        { name: 'مبتدئ', rank: 1, minimumPoints: 0, color: '#64748b' },
        { name: 'متعلّم', rank: 2, minimumPoints: 500, color: '#0ea5e9' },
        { name: 'متقدّم', rank: 3, minimumPoints: 1500, color: '#8b5cf6' },
        { name: 'خبير', rank: 4, minimumPoints: 4000, color: '#f59e0b' },
      ])
      .onConflictDoNothing()

    await tx
      .insert(educationalSections)
      .values([
        {
          name: 'العربية',
          slug: 'arabic',
          shortDescription: 'مسارات تعلم اللغة العربية',
          color: '#14b8a6',
          access: 'free',
          status: 'published',
          sortOrder: 10,
        },
        {
          name: 'English',
          slug: 'english',
          shortDescription: 'English learning paths',
          color: '#3b82f6',
          access: 'free',
          status: 'published',
          sortOrder: 20,
        },
        {
          name: 'الرياضيات',
          slug: 'mathematics',
          shortDescription: 'مسارات الرياضيات والمهارات الحسابية',
          color: '#8b5cf6',
          access: 'free',
          status: 'published',
          sortOrder: 30,
        },
        {
          name: 'القراءة',
          slug: 'reading',
          shortDescription: 'قصص وأنشطة الفهم القرائي',
          color: '#f59e0b',
          access: 'free',
          status: 'draft',
          sortOrder: 40,
        },
        {
          name: 'العلوم',
          slug: 'science',
          shortDescription: 'محتوى العلوم والأنشطة الاستكشافية',
          color: '#22c55e',
          access: 'free',
          status: 'draft',
          sortOrder: 50,
        },
      ])
      .onConflictDoNothing()

    await tx
      .insert(categories)
      .values([
        {
          scope: 'platform',
          userId: null,
          language: 'ar',
          name: 'عام',
          normalizedName: 'عام',
          slug: 'arabic-general',
          description: 'الكلمات العربية العامة',
          sortOrder: 10,
        },
        {
          scope: 'platform',
          userId: null,
          language: 'en',
          name: 'General',
          normalizedName: 'general',
          slug: 'english-general',
          description: 'General English vocabulary',
          sortOrder: 10,
        },
        {
          scope: 'platform',
          userId: null,
          language: 'en',
          name: 'Daily life',
          normalizedName: 'daily life',
          slug: 'daily-life',
          description: 'Everyday English vocabulary',
          sortOrder: 20,
        },
      ])
      .onConflictDoNothing()

    await tx
      .insert(mathSections)
      .values([
        {
          slug: 'basics',
          name: 'الأساسيات',
          normalizedName: 'الأساسيات',
          description: 'الجمع والطرح والضرب والقسمة',
          sortOrder: 10,
        },
        {
          slug: 'fractions',
          name: 'الكسور',
          normalizedName: 'الكسور',
          description: 'الكسور والنسب',
          sortOrder: 20,
        },
        {
          slug: 'algebra',
          name: 'الجبر',
          normalizedName: 'الجبر',
          description: 'المعادلات والمفاهيم الجبرية',
          sortOrder: 30,
        },
      ])
      .onConflictDoNothing()

    await tx
      .insert(achievements)
      .values([
        {
          name: 'البداية',
          description: 'إضافة أول كلمة',
          requirementType: 'words',
          requirementValue: 1,
          xpReward: 10,
          coinReward: 2,
          sortOrder: 10,
        },
        {
          name: 'جامع الكلمات',
          description: 'إضافة 100 كلمة',
          requirementType: 'words',
          requirementValue: 100,
          xpReward: 100,
          coinReward: 25,
          sortOrder: 20,
        },
        {
          name: 'المراجع المثابر',
          description: 'إكمال 50 مراجعة',
          requirementType: 'reviews',
          requirementValue: 50,
          xpReward: 75,
          coinReward: 20,
          sortOrder: 30,
        },
      ])
      .onConflictDoNothing()

    await tx
      .insert(encouragementMessages)
      .values([
        { message: 'كل خطوة صغيرة تقرّبك من الطلاقة.', minProgress: 0, maxProgress: 39, sortOrder: 10 },
        { message: 'أنت في منتصف الطريق، استمر!', minProgress: 40, maxProgress: 79, sortOrder: 20 },
        { message: 'إنجاز رائع؛ بقي القليل.', minProgress: 80, maxProgress: 100, sortOrder: 30 },
      ])
      .onConflictDoNothing()
  })
  console.info('Seed completed successfully.')
}

seed()
  .catch((error) => {
    console.error('Seed failed:', error instanceof Error ? error.message : 'unknown database error')
    process.exitCode = 1
  })
  .finally(() => pool.end())
