'use client'

import { FormEvent, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { bulkUpdateManagedUsers } from '@/app/admin/actions'
import { ConfirmationDialog } from '@/components/admin/confirmation-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { publicActionError } from '@/lib/public-error'

type Result = { ok: boolean; message: string }

export function BulkUserActions({ userIds, onComplete }: { userIds: string[]; onComplete: () => void }) {
  const router = useRouter()
  const ref = useRef<HTMLFormElement>(null)
  const [pending, startTransition] = useTransition()
  const [queued, setQueued] = useState<FormData | null>(null)
  const [result, setResult] = useState<Result | null>(null)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!userIds.length) {
      setResult({ ok: false, message: 'اختر مستخدمًا واحدًا على الأقل.' })
      return
    }
    const payload = new FormData(event.currentTarget)
    payload.set('userIds', JSON.stringify(userIds))
    setQueued(payload)
  }

  function execute() {
    if (!queued) return
    setResult(null)
    startTransition(async () => {
      try {
        const response = await bulkUpdateManagedUsers(queued)
        setResult(response)
        if (response.ok) {
          ref.current?.reset()
          onComplete()
          router.refresh()
        }
      } catch (error) {
        setResult({
          ok: false,
          message: publicActionError(error, 'تعذر تنفيذ العملية الجماعية.'),
        })
      } finally {
        setQueued(null)
      }
    })
  }

  return (
    <div className="admin-stack-sm">
      <form ref={ref} onSubmit={submit} className="admin-filter-form">
        <strong>المحدد: {userIds.length}</strong>
        <select name="operation" defaultValue="status" aria-label="العملية الجماعية">
          <option value="status">تغيير حالة الحساب</option>
          <option value="note">إضافة ملاحظة إدارية</option>
        </select>
        <select name="status" defaultValue="active" aria-label="الحالة الجماعية">
          <option value="active">نشط</option>
          <option value="disabled">معطل</option>
          <option value="banned">محظور</option>
        </select>
        <select name="severity" defaultValue="info" aria-label="درجة الملاحظة">
          <option value="info">معلومة</option>
          <option value="warning">تحذير</option>
          <option value="critical">حرجة</option>
        </select>
        <Input aria-label="سبب أو نص الملاحظة" name="reason" required minLength={5} maxLength={1000} placeholder="سبب أو نص الملاحظة" />
        <Button disabled={pending || !userIds.length}>
          {pending ? 'جارٍ التنفيذ...' : 'تطبيق على المحدد'}
        </Button>
      </form>
      {result && (
        <Alert variant={result.ok ? 'default' : 'destructive'}>
          <AlertDescription>{result.message}</AlertDescription>
        </Alert>
      )}
      <ConfirmationDialog
        open={Boolean(queued)}
        description={`سيتم تطبيق العملية على ${userIds.length} مستخدمًا داخل معاملة واحدة. هل تريد المتابعة؟`}
        pending={pending}
        onCancel={() => setQueued(null)}
        onConfirm={execute}
      />
    </div>
  )
}
