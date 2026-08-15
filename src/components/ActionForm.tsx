'use client'

import { useActionState, useEffect, useRef } from 'react'
import { useFormStatus } from 'react-dom'

export type ActionState = { error?: string; ok?: string } | null

/**
 * ฟอร์มที่ผูกกับ Server Action พร้อมแสดงข้อความ error / สำเร็จ
 * ถ้า resetOnSuccess = true จะล้างฟอร์มให้หลังบันทึกผ่าน
 */
export function ActionForm({
  action,
  children,
  className = '',
  resetOnSuccess = false,
}: {
  action: (formData: FormData) => Promise<ActionState>
  children: React.ReactNode
  className?: string
  resetOnSuccess?: boolean
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const [state, formAction] = useActionState<ActionState, FormData>(
    async (_prev, formData) => action(formData),
    null
  )

  useEffect(() => {
    if (resetOnSuccess && state?.ok) formRef.current?.reset()
  }, [state, resetOnSuccess])

  return (
    <form ref={formRef} action={formAction} className={className}>
      {children}
      {state?.error ? (
        <p className="mt-3 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          {state.error}
        </p>
      ) : null}
      {state?.ok ? (
        <p className="mt-3 rounded-lg border border-good/40 bg-good/10 px-3 py-2 text-sm text-good">
          {state.ok}
        </p>
      ) : null}
    </form>
  )
}

export function SubmitButton({
  children,
  className = 'btn-primary',
  pendingLabel = 'กำลังบันทึก...',
}: {
  children: React.ReactNode
  className?: string
  pendingLabel?: string
}) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? pendingLabel : children}
    </button>
  )
}

/** ปุ่มในตาราง ที่ถามยืนยันก่อนส่งฟอร์ม */
export function ConfirmButton({
  children,
  message,
  className = 'btn-danger btn-sm',
}: {
  children: React.ReactNode
  message: string
  className?: string
}) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      className={className}
      disabled={pending}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault()
      }}
    >
      {pending ? '...' : children}
    </button>
  )
}
