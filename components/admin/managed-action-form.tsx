'use client'

import { FormEvent, ReactNode, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ConfirmationDialog } from '@/components/admin/confirmation-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { publicActionError } from '@/lib/public-error'

type Result = { ok: boolean; message: string }

export function ManagedActionForm({
  action,
  label,
  confirm,
  children,
  resetOnSuccess = false,
}: {
  action: (form: FormData) => Promise<Result>
  label: string
  confirm?: string
  children: ReactNode
  resetOnSuccess?: boolean
}) {
  const router = useRouter()
  const ref = useRef<HTMLFormElement>(null)
  const [pending, startTransition] = useTransition()
  const [queued, setQueued] = useState<FormData | null>(null)
  const [result, setResult] = useState<Result | null>(null)

  function execute(payload: FormData) {
    setResult(null)
    startTransition(async () => {
      try {
        const response = await action(payload)
        setResult(response)
        if (response.ok) {
          if (resetOnSuccess) ref.current?.reset()
          router.refresh()
        }
      } catch (error) {
        setResult({ ok: false, message: publicActionError(error, 'تعذر تنفيذ العملية.') })
      } finally {
        setQueued(null)
      }
    })
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const payload = new FormData(event.currentTarget)
    if (confirm) setQueued(payload)
    else execute(payload)
  }

  return (
    <>
      <form ref={ref} onSubmit={submit} className="admin-form">
        {children}
        {result && (
          <Alert variant={result.ok ? 'default' : 'destructive'}>
            <AlertDescription>{result.message}</AlertDescription>
          </Alert>
        )}
        <Button disabled={pending}>{pending ? 'جارٍ التنفيذ...' : label}</Button>
      </form>
      {confirm && (
        <ConfirmationDialog
          open={Boolean(queued)}
          description={confirm}
          pending={pending}
          onCancel={() => setQueued(null)}
          onConfirm={() => queued && execute(queued)}
        />
      )}
    </>
  )
}
