import { eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { educationalSections, userProgress } from '@/lib/db/schema'

type SectionAccessRecord = Pick<
  typeof educationalSections.$inferSelect,
  'id' | 'access' | 'isPaid' | 'previousSectionId' | 'unlockRules'
>

function minimumXp(section: SectionAccessRecord) {
  const value = section.unlockRules?.minimumXp
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0
}

export async function getSectionAccessState(
  userId: string,
  section: SectionAccessRecord,
  options: { administrator?: boolean } = {},
) {
  if (options.administrator) return { allowed: true as const, reason: null, requiredXp: 0 }
  if (section.isPaid)
    return {
      allowed: false as const,
      reason: 'هذا قسم مدفوع ولا يمكن فتحه قبل تفعيل الاشتراك المناسب.',
      requiredXp: minimumXp(section),
    }

  const requiredXp = minimumXp(section)
  const [progress] = await db
    .select({ xp: userProgress.xp })
    .from(userProgress)
    .where(eq(userProgress.userId, userId))
    .limit(1)
  if ((progress?.xp ?? 0) < requiredXp)
    return {
      allowed: false as const,
      reason: `تحتاج إلى ${requiredXp} XP لفتح هذا القسم.`,
      requiredXp,
    }

  if (section.previousSectionId) {
    const [completion] = await db.execute<{ total: number; completed: number }>(sql`
      select
        count(c.id)::int as total,
        count(c.id) filter (where p.status = 'completed')::int as completed
      from "sectionContents" c
      left join "userContentProgress" p
        on p."contentId" = c.id and p."userId" = ${userId}
      where c."sectionId" = ${section.previousSectionId}::uuid
        and c."deletedAt" is null
        and c.status in ('published','scheduled')
        and (c.status <> 'scheduled' or c."publishedAt" <= now())
    `)
    if (!completion || completion.total === 0 || completion.completed < completion.total)
      return {
        allowed: false as const,
        reason: 'أكمل محتوى القسم السابق أولًا.',
        requiredXp,
      }
  }

  if (section.access === 'restricted' && requiredXp === 0 && !section.previousSectionId)
    return {
      allowed: false as const,
      reason: 'هذا القسم مقيّد حاليًا من إدارة المنصة.',
      requiredXp,
    }
  return { allowed: true as const, reason: null, requiredXp }
}
