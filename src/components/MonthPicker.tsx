'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useTransition } from 'react'
import { monthLabel } from '@/lib/format'

type Props = { value: string; months: string[] }

/**
 * ตัวเลือกเดือน — เปลี่ยนแล้วโหลดหน้าเดิมด้วย query ?month=YYYY-MM
 * useSearchParams ต้องอยู่ใน Suspense เสมอ ไม่งั้นหน้าอาจพังตอน render ฝั่งเบราว์เซอร์
 */
export function MonthPicker(props: Props) {
  return (
    <Suspense fallback={<MonthSelect {...props} disabled />}>
      <MonthPickerInner {...props} />
    </Suspense>
  )
}

function MonthPickerInner({ value, months }: Props) {
  const router = useRouter()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()

  return (
    <MonthSelect
      value={value}
      months={months}
      disabled={pending}
      onPick={(month) => {
        const next = new URLSearchParams(params?.toString() ?? '')
        next.set('month', month)
        startTransition(() => router.push(`?${next.toString()}`))
      }}
    />
  )
}

function MonthSelect({
  value,
  months,
  disabled,
  onPick,
}: Props & { disabled?: boolean; onPick?: (month: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-mute">
      <span className="hidden sm:inline">เดือน</span>
      <select
        className="input w-auto py-1.5"
        value={value}
        disabled={disabled}
        onChange={(e) => onPick?.(e.target.value)}
      >
        {months.map((m) => (
          <option key={m} value={m}>
            {monthLabel(m)}
          </option>
        ))}
      </select>
    </label>
  )
}
