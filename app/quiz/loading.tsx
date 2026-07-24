import { Skeleton } from '@/components/ui/skeleton'

export default function QuizLoading() {
  return (
    <main className="admin-stack" aria-busy="true" aria-label="جارٍ تحميل الاختبارات">
      <Skeleton className="h-20 w-full" />
      <div className="quiz-mode-grid">
        {Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-36 w-full" />)}
      </div>
    </main>
  )
}
