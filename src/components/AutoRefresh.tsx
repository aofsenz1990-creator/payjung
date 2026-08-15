'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'

/**
 * ดึงข้อมูลใหม่ให้เองเป็นระยะ ทำให้หน้าจออัปเดตตามคนอื่นที่ลงยอดขายพร้อมกัน
 *
 * ออกแบบให้ประหยัดโควตา:
 * - หยุดดึงเมื่อสลับแท็บไปทำอย่างอื่น (ไม่มีคนดูก็ไม่ต้องดึง)
 * - กลับมาที่แท็บเมื่อไหร่ ดึงทันทีหนึ่งครั้ง จะได้เห็นข้อมูลล่าสุดเลย
 * - กดหยุดชั่วคราวเองได้
 */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter()
  const [enabled, setEnabled] = useState(true)
  const [lastAt, setLastAt] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  const refresh = useCallback(() => {
    startTransition(() => {
      router.refresh()
      setLastAt(
        new Intl.DateTimeFormat('th-TH', {
          timeZone: 'Asia/Bangkok',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }).format(new Date())
      )
    })
  }, [router])

  useEffect(() => {
    if (!enabled) return

    const timer = setInterval(() => {
      // แท็บถูกซ่อนอยู่ = ไม่มีใครดู ข้ามรอบนี้ไป
      if (document.visibilityState !== 'visible') return
      refresh()
    }, seconds * 1000)

    function onVisible() {
      if (document.visibilityState === 'visible' && enabledRef.current) refresh()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, seconds, refresh])

  return (
    <div className="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-xs">
      <span
        aria-hidden
        className={`size-2 rounded-full ${
          pending
            ? 'animate-pulse bg-warn'
            : enabled
              ? 'animate-pulse bg-good'
              : 'bg-ink-600'
        }`}
      />
      <span className="text-mute">
        {pending ? 'กำลังอัปเดต...' : enabled ? `อัปเดตทุก ${seconds} วิ` : 'หยุดอัปเดตอยู่'}
        {lastAt ? <span className="ml-1.5 text-slate-300">· {lastAt}</span> : null}
      </span>
      <button
        type="button"
        onClick={refresh}
        className="text-brand-400 hover:underline"
        title="อัปเดตเดี๋ยวนี้"
      >
        รีเฟรช
      </button>
      <button
        type="button"
        onClick={() => setEnabled((v) => !v)}
        className="text-mute hover:text-slate-200"
        title={enabled ? 'หยุดอัปเดตอัตโนมัติ' : 'เปิดอัปเดตอัตโนมัติ'}
      >
        {enabled ? '⏸' : '▶'}
      </button>
    </div>
  )
}
