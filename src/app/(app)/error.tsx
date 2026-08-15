'use client'

import { useEffect } from 'react'

/** ดักจับ error ของหน้าที่อยู่หลังการล็อกอิน แล้วแสดงรายละเอียดให้พอแก้ปัญหาได้ */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[PayJung]', error)
  }, [error])

  return (
    <div className="mx-auto max-w-lg py-10">
      <div className="card">
        <h1 className="text-lg font-bold text-white">หน้านี้โหลดไม่สำเร็จ</h1>
        <p className="mt-2 text-sm leading-relaxed text-mute">
          ลองกดโหลดใหม่ดูก่อนครับ ถ้ายังไม่หาย ให้ส่งข้อความด้านล่างนี้ให้คนดูแลระบบ
        </p>

        <pre className="mt-4 overflow-x-auto rounded-lg border border-ink-700 bg-ink-850 p-3 text-xs text-bad">
          {error.message || 'ไม่มีรายละเอียดเพิ่มเติม'}
          {error.digest ? `\n\ndigest: ${error.digest}` : ''}
        </pre>

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={() => reset()}>
            ลองใหม่
          </button>
          <a href="/" className="btn-ghost">
            กลับหน้าแดชบอร์ด
          </a>
          <a href="/login" className="btn-ghost">
            ออกไปหน้าเข้าสู่ระบบ
          </a>
        </div>

        <p className="mt-4 text-xs leading-relaxed text-mute">
          ถ้าเพิ่งมีการอัปเดตระบบ ให้กด <b>Ctrl + Shift + R</b> เพื่อล้างแคชของเบราว์เซอร์
          แล้วลองอีกครั้ง
        </p>
      </div>
    </div>
  )
}
