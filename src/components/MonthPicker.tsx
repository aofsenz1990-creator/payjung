'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import { monthLabel } from '@/lib/format'

/** ตัวเลือกเดือน — เปลี่ยนแล้วโหลดหน้าเดิมด้วย query ?month=YYYY-MM */
export function MonthPicker({ value, months }: { value: string; months: string[] }) {
  const router = useRouter()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()

  return (
    <label className="flex items-center gap-2 text-sm text-mute">
      <span className="hidden sm:inline">เดือน</span>
      <select
        className="input w-auto py-1.5"
        value={value}
        disabled={pending}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString())
          next.set('month', e.target.value)
          startTransition(() => router.push(`?${next.toString()}`))
        }}
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
