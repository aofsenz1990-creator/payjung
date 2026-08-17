'use client'

import { useState } from 'react'

/**
 * รายการโค้ดที่เพิ่งสร้าง พร้อมปุ่มคัดลอกทั้งชุด
 *
 * ที่ต้องมีปุ่มคัดลอกทั้งชุด เพราะสร้างทีละ 50-200 ใบแล้วมานั่งลากเลือกทีละบรรทัด
 * บนตารางที่เลื่อนได้ เป็นงานที่พลาดง่ายมาก — คัดลอกไม่ครบแล้วโค้ดที่ตกหล่นจะหายไปเลย
 */
export function CodeList({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false)

  return (
    <div>
      <div className="max-h-48 overflow-y-auto rounded-lg border border-ink-700 bg-ink-950 p-2">
        {codes.map((c) => (
          <p key={c} className="font-mono text-xs text-slate-200 select-all">
            {c}
          </p>
        ))}
      </div>
      <button
        type="button"
        className={copied ? 'btn-ghost mt-2 w-full text-good' : 'btn-ghost mt-2 w-full'}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(codes.join('\n'))
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          } catch {
            // เบราว์เซอร์บางตัวไม่ให้คัดลอกอัตโนมัติ — ยังลากเลือกเองได้อยู่
          }
        }}
      >
        {copied ? '✓ คัดลอกแล้ว' : `คัดลอกทั้งหมด ${codes.length} ใบ`}
      </button>
    </div>
  )
}
