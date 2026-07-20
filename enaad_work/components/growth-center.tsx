'use client'
import { joinChallenge } from '@/app/actions'
import type { getData } from '@/app/actions'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Award, CheckCircle2, Coins, Flame, Target, Trophy, Users, Zap } from 'lucide-react'

type GrowthData = Awaited<ReturnType<typeof getData>>

export function GrowthCenter({ data }: { data: GrowthData }) {
  const profile = data.progress || { xp: 0, coins: 0, streak: 0, title: 'مبتدئ' }
  const joined = new Map(data.participations.map((item) => [item.challengeId, item]))
  const completed = data.participations.filter((item) => item.status === 'completed').length
  return (
    <main className="challenges-page">
      <section className="challenge-hero">
        <div>
          <p className="eyebrow">تحديات لُغتي</p>
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
                </div>
              ) : (
                <form
                  action={async () => {
                    await joinChallenge(challenge.id)
                  }}
                >
                  <Button type="submit" className="challenge-join">
                    انضم وابدأ الآن
                  </Button>
                </form>
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
