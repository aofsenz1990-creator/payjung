'use client'

import { createContext, useActionState, useContext, useEffect, useRef } from 'react'
import { useFormStatus } from 'react-dom'

export type ActionState = { error?: string; ok?: string } | null

/**
 * ผลลัพธ์ล่าสุดของฟอร์ม เผื่อให้ลูกส่วนไหนก็ได้เอาไปแสดงเอง
 * ใช้ตอนที่ข้อความต้องไปโผล่ในกล่องป็อปอัป ไม่ใช่ท้ายฟอร์มตามปกติ
 */
const ActionStateContext = createContext<ActionState>(null)

export function useActionFormState() {
  return useContext(ActionStateContext)
}

/** กล่องข้อความผลลัพธ์ วางตรงไหนก็ได้ในฟอร์ม (ใช้คู่กับ hideMessage) */
export function ActionMessage({ className = '' }: { className?: string }) {
  const state = useActionFormState()
  if (state?.error) {
    return (
      <p
        className={`rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad ${className}`}
      >
        {state.error}
      </p>
    )
  }
  if (state?.ok) {
    return (
      <p
        className={`rounded-lg border border-good/40 bg-good/10 px-3 py-2 text-sm text-good ${className}`}
      >
        {state.ok}
      </p>
    )
  }
  return null
}

/**
 * ฟอร์มที่ผูกกับ Server Action พร้อมแสดงข้อความ error / สำเร็จ
 * ถ้า resetOnSuccess = true จะล้างฟอร์มให้หลังบันทึกผ่าน
 */
export function ActionForm({
  action,
  children,
  className = '',
  resetOnSuccess = false,
  onSuccess,
  id,
  hideMessage = false,
}: {
  action: (formData: FormData) => Promise<ActionState>
  children: React.ReactNode
  className?: string
  resetOnSuccess?: boolean
  /** เรียกหลังบันทึกผ่าน ใช้ล้างค่าที่ฟอร์ม reset() เองไม่ได้ เช่นรูปที่แนบไว้ */
  onSuccess?: () => void
  /**
   * ตั้ง id ให้ฟอร์ม เพื่อให้ช่องกรอกที่อยู่นอกฟอร์มผูกเข้ามาได้ด้วย form="ไอดีนี้"
   * ใช้ตอนที่ช่องกรอกต้องอยู่ในตารางซึ่งมีฟอร์มอื่นอยู่แล้ว เพราะฟอร์มซ้อนกันไม่ได้
   */
  id?: string
  /** ไม่ต้องแสดงข้อความท้ายฟอร์ม — ใช้เมื่อจะเอา <ActionMessage /> ไปวางเองที่อื่น */
  hideMessage?: boolean
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const [state, formAction] = useActionState<ActionState, FormData>(
    async (_prev, formData) => action(formData),
    null
  )

  useEffect(() => {
    if (!state?.ok) return
    if (resetOnSuccess) formRef.current?.reset()
    onSuccess?.()
    // ตั้งใจไม่ใส่ onSuccess ใน deps เพื่อไม่ให้ยิงซ้ำเวลา parent สร้างฟังก์ชันใหม่
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, resetOnSuccess])

  return (
    <form ref={formRef} id={id} action={formAction} className={className}>
      <ActionStateContext.Provider value={state}>{children}</ActionStateContext.Provider>
      {hideMessage ? null : state?.error ? (
        <p className="mt-3 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          {state.error}
        </p>
      ) : null}
      {hideMessage ? null : state?.ok ? (
        <p className="mt-3 rounded-lg border border-good/40 bg-good/10 px-3 py-2 text-sm text-good">
          {state.ok}
        </p>
      ) : null}
    </form>
  )
}

/**
 * ปุ่มส่งฟอร์มที่รู้สถานะกำลังส่งอยู่
 *
 * รับ name/value ได้ด้วย เพื่อให้ฟอร์มเดียวมีหลายปุ่มที่สั่งงานต่างกันได้
 * (เช่น "นำเข้าเกมที่เลือก" กับ "นำเข้าทั้งหมด" ใช้ฟอร์มเดียวกันแต่ส่งค่าต่างกัน)
 * เบราว์เซอร์จะส่ง name=value ของปุ่มที่ถูกกดไปด้วยเท่านั้น
 */
export function SubmitButton({
  children,
  className = 'btn-primary',
  pendingLabel = 'กำลังบันทึก...',
  disabled = false,
  title,
  name,
  value,
}: {
  children: React.ReactNode
  className?: string
  pendingLabel?: string
  disabled?: boolean
  title?: string
  name?: string
  value?: string
}) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      className={className}
      disabled={pending || disabled}
      title={title}
      name={name}
      value={value}
    >
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
