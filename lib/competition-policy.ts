export type CompetitionLifecycle = 'draft' | 'scheduled' | 'active' | 'ended' | 'cancelled'
export type CompetitionAudience = 'all' | 'verified' | 'new_users' | 'existing_users'

export type CompetitionWindowInput = {
  lifecycle: CompetitionLifecycle
  isActive: boolean
  startsAt: Date | null
  endsAt: Date | null
  audience: CompetitionAudience
  requiresVerifiedEmail: boolean
}

export type CompetitionUserInput = {
  emailVerified: boolean
  createdAt: Date
}

export type CompetitionAvailability =
  | { ok: true }
  | {
      ok: false
      code:
        | 'UNAVAILABLE'
        | 'NOT_STARTED'
        | 'ENDED'
        | 'EMAIL_NOT_VERIFIED'
        | 'AUDIENCE_NEW_ONLY'
        | 'AUDIENCE_EXISTING_ONLY'
      message: string
    }

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1_000

export function getCompetitionAvailability(
  competition: CompetitionWindowInput,
  user?: CompetitionUserInput,
  now = new Date(),
): CompetitionAvailability {
  if (!competition.isActive || competition.lifecycle === 'draft' || competition.lifecycle === 'cancelled') {
    return { ok: false, code: 'UNAVAILABLE', message: 'المنافسة غير متاحة حاليًا.' }
  }
  if (competition.lifecycle === 'ended' || (competition.endsAt && competition.endsAt.getTime() <= now.getTime())) {
    return { ok: false, code: 'ENDED', message: 'انتهت المنافسة.' }
  }
  if (competition.startsAt && competition.startsAt.getTime() > now.getTime()) {
    return { ok: false, code: 'NOT_STARTED', message: 'لم تبدأ المنافسة بعد.' }
  }
  if (!user) return { ok: true }

  if ((competition.requiresVerifiedEmail || competition.audience === 'verified') && !user.emailVerified) {
    return {
      ok: false,
      code: 'EMAIL_NOT_VERIFIED',
      message: 'يجب توثيق بريدك الإلكتروني قبل الانضمام إلى هذه المنافسة.',
    }
  }

  const accountAge = now.getTime() - user.createdAt.getTime()
  if (competition.audience === 'new_users' && accountAge > THIRTY_DAYS_MS) {
    return {
      ok: false,
      code: 'AUDIENCE_NEW_ONLY',
      message: 'هذه المنافسة مخصصة للمستخدمين الجدد.',
    }
  }
  if (competition.audience === 'existing_users' && accountAge <= THIRTY_DAYS_MS) {
    return {
      ok: false,
      code: 'AUDIENCE_EXISTING_ONLY',
      message: 'هذه المنافسة مخصصة للمستخدمين الحاليين منذ أكثر من 30 يومًا.',
    }
  }
  return { ok: true }
}
