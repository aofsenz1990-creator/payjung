'use client'

import { useEffect, useState } from 'react'

/**
 * ปุ่ม LINE ที่กดแล้วเด้ง QR ขึ้นมาให้สแกน
 *
 * ทำไมไม่ลิงก์ตรงไป LINE อย่างเดียว: คนที่เปิดเว็บบนคอมกดลิงก์แล้วมักไม่มีอะไรเกิดขึ้น
 * (ไม่ได้ติดตั้ง LINE บนเครื่อง) การโชว์ QR ให้สแกนด้วยมือถือจึงใช้ได้กับทุกคน
 * ส่วนคนที่เปิดบนมือถือก็ยังมีปุ่มเปิดแอปให้กดอยู่ในกล่องเดียวกัน
 */
export function LineQrButton({
  qrUrl,
  lineUrl,
  lineId,
}: {
  qrUrl: string
  lineUrl: string | null
  lineId: string | null
}) {
  const [open, setOpen] = useState(false)

  // กด Esc เพื่อปิด — คนที่ใช้คีย์บอร์ดคาดหวังแบบนี้เสมอ
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="แอดไลน์ร้าน"
        title="แอดไลน์ร้าน"
        className="group relative flex size-12 items-center justify-center rounded-full bg-[#06C755] text-white shadow-lg shadow-black/40 transition hover:scale-110 active:scale-95"
      >
        <span className="pointer-events-none absolute right-full mr-2 hidden whitespace-nowrap rounded-lg bg-ink-950/90 px-2.5 py-1 text-xs text-fg opacity-0 shadow-lg transition group-hover:opacity-100 sm:block">
          แอดไลน์ร้าน
        </span>
        <span className="text-[11px] font-extrabold tracking-tight">LINE</span>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          {/* กันไม่ให้การกดในกล่องทะลุไปโดนพื้นหลังจนปิดเอง */}
          <div
            className="w-full max-w-xs rounded-2xl border border-ink-700 bg-ink-900 p-5 text-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-base font-semibold text-fg">แอดไลน์ร้าน Pay Jung</p>
            <p className="mt-1 text-xs text-mute">สแกน QR นี้ด้วยแอป LINE ในมือถือ</p>

            <div className="mt-4 overflow-hidden rounded-xl bg-white p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrUrl} alt="QR code ไลน์ของร้าน" className="mx-auto w-full max-w-[220px]" />
            </div>

            {lineId ? (
              <p className="mt-3 font-mono text-sm text-brand-400 select-all">{lineId}</p>
            ) : null}

            <div className="mt-4 space-y-2">
              {lineUrl ? (
                <a
                  href={lineUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-primary w-full"
                  style={{ background: '#06C755' }}
                >
                  เปิดในแอป LINE
                </a>
              ) : null}
              <button type="button" className="btn-ghost w-full" onClick={() => setOpen(false)}>
                ปิด
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
