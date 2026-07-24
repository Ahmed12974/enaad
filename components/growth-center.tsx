'use client'
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { issueCertificate, joinChallenge } from '@/app/actions'
import type { getData } from '@/app/actions'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Award, CheckCircle2, Coins, FileCheck2, Flame, Target, Trophy, Users, Zap } from 'lucide-react'

type GrowthData = Awaited<ReturnType<typeof getData>>

const achievementRequirementLabels: Record<string, string> = {
  words: 'كلمات مضافة',
  reviews: 'مراجعات مكتملة',
  points: 'نقاط خبرة',
  lessons_completed: 'دروس مكتملة',
  challenge_wins: 'تحديات مكتملة',
  activity_streak: 'أيام نشاط متتالية',
}

function achievementRequirementLabel(value: string) {
  return achievementRequirementLabels[value] ?? 'معيار إنجاز'
}


const badgeRarityLabels: Record<string, string> = {
  common: 'شائعة',
  rare: 'نادرة',
  epic: 'ملحمية',
  legendary: 'أسطورية',
}

export function GrowthCenter({
  data,
  view = 'challenges',
}: {
  data: GrowthData
  view?: 'challenges' | 'achievements'
}) {
  const [pending, startTransition] = useTransition()
  if (view === 'achievements') return <AchievementsCenter data={data} />
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const profile = data.progress || { xp: 0, coins: 0, streak: 0, title: 'مبتدئ' }
  const joined = new Map(data.participations.map((item) => [item.challengeId, item]))
  const completed = data.participations.filter((item) => item.status === 'completed').length
  const certificatesByChallenge = new Map(
    data.certificates
      .filter((item) => item.challengeId !== null)
      .map((item) => [item.challengeId as number, item]),
  )
  return (
    <main className="challenges-page">
      <section className="challenge-hero">
        <div>
          <p className="eyebrow">تحديات أكاديمية زايد التعليمية</p>
          <h1>
            ابدأ الآن.
            <br />
            اكسب أكثر.
          </h1>
          <p>أهداف قصيرة ومكافآت حقيقية تحوّل تعلّمك اليومي إلى سلسلة انتصارات.</p>
          <div className="challenge-hero-proof">
            <span>
              <Flame />
              {profile.streak} أيام متتالية
            </span>
            <span>
              <Trophy />
              {completed} مكتمل
            </span>
          </div>
        </div>
        <div className="challenge-score">
          <Zap />
          <strong>{profile.xp}</strong>
          <span>نقطة خبرة</span>
        </div>
      </section>
      <section className="challenge-summary">
        <Card>
          <CardContent>
            <Coins />
            <strong>{profile.coins}</strong>
            <span>Coins متاحة</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Target />
            <strong>{data.challenges.length}</strong>
            <span>تحديات نشطة</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Award />
            <strong>{profile.title}</strong>
            <span>لقبك الحالي</span>
          </CardContent>
        </Card>
      </section>
      <div className="challenge-section-title">
        <div>
          <p className="eyebrow">اختر هدفك التالي</p>
          <h2>تحديات تستحق أن تبدأها</h2>
        </div>
        <span>{data.challenges.length} فرص متاحة</span>
      </div>
      {message && (
        <p className={message.ok ? 'success' : 'error'} role="status">
          {message.text}
        </p>
      )}
      <section className="challenge-showcase">
        {data.challenges.map((challenge, index) => {
          const participation = joined.get(challenge.id)
          const percent = participation
            ? Math.min(100, Math.round((participation.progress / challenge.target) * 100))
            : 0
          const isDone = participation?.status === 'completed'
          return (
            <article
              className={`challenge-card ${participation ? 'joined' : ''} ${isDone ? 'completed' : ''}`}
              key={challenge.id}
            >
              <div className="challenge-card-top">
                <span className="challenge-number">{String(index + 1).padStart(2, '0')}</span>
                <span className="challenge-status">
                  {isDone ? (
                    <>
                      <CheckCircle2 />
                      مكتمل
                    </>
                  ) : participation ? (
                    'أنت مشترك'
                  ) : (
                    'متاح الآن'
                  )}
                </span>
              </div>
              <div className="challenge-symbol">
                <Trophy />
              </div>
              <h3>{challenge.title}</h3>
              <p>{challenge.description}</p>
              <div className="challenge-rewards">
                <span>
                  <Zap />
                  {challenge.xpReward} XP
                </span>
                <span>
                  <Coins />
                  {challenge.coinReward} Coins
                </span>
                {challenge.badgeName && (
                  <span>
                    <Award />
                    {challenge.badgeName}
                  </span>
                )}
              </div>
              <div className="challenge-social">
                <Users />
                <b>{data.participantCounts?.[challenge.id] || 0}</b>
                <span>متعلمون انضموا</span>
              </div>
              {participation ? (
                <div className="challenge-progress">
                  <div>
                    <b>{isDone ? 'أحسنت، أنجزت التحدي' : 'واصل التقدم'}</b>
                    <strong>{percent}%</strong>
                  </div>
                  <Progress value={percent} />
                  <small>
                    {participation.progress} من {challenge.target}
                  </small>
                  {isDone && certificatesByChallenge.get(challenge.id) && (
                    <Button
                      variant="outline"
                      render={<Link href={`/certificates/${certificatesByChallenge.get(challenge.id)!.id}`} />}
                    >
                      <FileCheck2 /> عرض الشهادة
                    </Button>
                  )}
                  {isDone && !certificatesByChallenge.get(challenge.id) && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          try {
                            const certificate = await issueCertificate(challenge.id)
                            window.location.assign(`/certificates/${certificate.id}`)
                          } catch {
                            setMessage({ ok: false, text: 'تعذر إصدار الشهادة. حاول مرة أخرى.' })
                          }
                        })
                      }
                    >
                      <FileCheck2 /> {pending ? 'جارٍ الإصدار…' : 'إصدار شهادة الإنجاز'}
                    </Button>
                  )}
                </div>
              ) : (
                <Button
                  type="button"
                  className="challenge-join"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      try {
                        const result = await joinChallenge(challenge.id)
                        setMessage({
                          ok: result.ok,
                          text: result.ok ? 'تم الانضمام إلى التحدي.' : result.message,
                        })
                      } catch {
                        setMessage({ ok: false, text: 'تعذر الانضمام إلى التحدي.' })
                      }
                    })
                  }
                >
                  {pending ? 'جارٍ التنفيذ…' : 'انضم وابدأ الآن'}
                </Button>
              )}
            </article>
          )
        })}
      </section>
      {!data.challenges.length && (
        <section className="challenge-empty">
          <Target />
          <h2>تحديات جديدة قادمة</h2>
          <p>سيضيف مدير المنصة تحديات يمكنك الانضمام إليها قريباً.</p>
        </section>
      )}
    </main>
  )
}

function AchievementsCenter({ data }: { data: GrowthData }) {
  const profile = data.progress || { xp: 0, coins: 0, streak: 0, title: 'مبتدئ' }
  const earnedAchievementIds = new Set(data.earnedAchievements.map((item) => item.achievementId))
  const earnedBadgeIds = new Set(data.earnedBadges.map((item) => item.badgeId))

  return (
    <main className="challenges-page">
      <section className="challenge-hero">
        <div>
          <p className="eyebrow">سجل إنجازاتك وشاراتك</p>
          <h1>
            كل خطوة محسوبة.
            <br />
            وكل إنجاز محفوظ.
          </h1>
          <p>تابع ما حققته، واعرف الإنجازات والشارات التي ما زالت في انتظارك.</p>
          <div className="challenge-hero-proof">
            <span>
              <Award />
              {earnedAchievementIds.size} إنجازات مكتسبة
            </span>
            <span>
              <Trophy />
              {earnedBadgeIds.size} شارات فعالة
            </span>
          </div>
        </div>
        <div className="challenge-score">
          <Zap />
          <strong>{profile.xp}</strong>
          <span>نقطة خبرة</span>
        </div>
      </section>

      <section className="challenge-summary">
        <Card>
          <CardContent>
            <Coins />
            <strong>{profile.coins}</strong>
            <span>Coins متاحة</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <CheckCircle2 />
            <strong>{earnedAchievementIds.size}</strong>
            <span>إنجازات مكتسبة</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Award />
            <strong>{profile.title}</strong>
            <span>مستواك الحالي</span>
          </CardContent>
        </Card>
      </section>

      <div className="challenge-section-title">
        <div>
          <p className="eyebrow">الإنجازات</p>
          <h2>تقدمك نحو أهداف المنصة</h2>
        </div>
        <span>{earnedAchievementIds.size} من {data.achievements.length}</span>
      </div>
      <section className="challenge-showcase" aria-label="الإنجازات المتاحة والمكتسبة">
        {data.achievements.map((achievement) => {
          const earned = earnedAchievementIds.has(achievement.id)
          return (
            <article className={`challenge-card ${earned ? 'completed' : ''}`} key={achievement.id}>
              <div className="challenge-card-top">
                <span className="challenge-number"><Award /></span>
                <span className="challenge-status">
                  {earned ? (
                    <><CheckCircle2 /> مكتسب</>
                  ) : (
                    'قيد التقدم'
                  )}
                </span>
              </div>
              <h3>{achievement.name}</h3>
              <p>{achievement.description}</p>
              <div className="challenge-rewards">
                <span><Zap /> {achievement.xpReward} XP</span>
                <span><Coins /> {achievement.coinReward} Coins</span>
              </div>
              <small>
                المتطلب: {achievement.requirementValue} · {achievementRequirementLabel(achievement.requirementType)}
              </small>
            </article>
          )
        })}
      </section>
      {!data.achievements.length && (
        <section className="challenge-empty">
          <Award />
          <h2>لا توجد إنجازات منشورة الآن</h2>
          <p>ستظهر هنا الإنجازات التي تنشرها إدارة المنصة.</p>
        </section>
      )}

      <div className="challenge-section-title">
        <div>
          <p className="eyebrow">الشارات</p>
          <h2>الشارات المنشورة</h2>
        </div>
        <span>{earnedBadgeIds.size} مكتسبة</span>
      </div>
      <section className="challenge-showcase" aria-label="الشارات المنشورة">
        {data.badges.map((badge) => {
          const earned = earnedBadgeIds.has(badge.id)
          return (
            <article className={`challenge-card ${earned ? 'completed' : ''}`} key={badge.id}>
              <div className="challenge-card-top">
                <span className="challenge-number"><Trophy /></span>
                <span className="challenge-status">
                  {earned ? <><CheckCircle2 /> مكتسبة</> : (badgeRarityLabels[badge.rarity] ?? 'شارة')}
                </span>
              </div>
              <h3>{badge.name}</h3>
              <p>{badge.description}</p>
            </article>
          )
        })}
      </section>
      {!data.badges.length && (
        <section className="challenge-empty">
          <Trophy />
          <h2>لا توجد شارات منشورة الآن</h2>
          <p>ستظهر هنا الشارات التي تعتمدها إدارة المنصة.</p>
        </section>
      )}
    </main>
  )
}

