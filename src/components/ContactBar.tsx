'use client'

import { useState } from 'react'

/**
 * แถบช่องทางติดต่อท้ายหน้าเว็บ
 * LINE: ถ้ามี QR จะกดแล้วเปิด QR ให้สแกน พร้อมปุ่มเปิดแอป LINE ตรง ๆ
 * Facebook: กดแล้วเปิดเพจในแท็บใหม่
 */
export function ContactBar({
  line,
  lineUrl,
  lineQr,
  facebook,
  facebookUrl,
  phone,
  note,
}: {
  line?: string | null
  lineUrl?: string | null
  lineQr?: string | null
  facebook?: string | null
  facebookUrl?: string | null
  phone?: string | null
  note?: string | null
}) {
  const [showQr, setShowQr] = useState(false)
  const hasAny = line || facebook || phone

  if (!hasAny) {
    return <p className="mt-2 text-sm text-mute">ยังไม่ได้ตั้งค่าช่องทางติดต่อ</p>
  }

  const chip =
    'flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 text-sm transition hover:border-brand-500/60 hover:bg-ink-800'

  return (
    <>
      <div className="mt-3 flex flex-wrap gap-3">
        {line ? (
          lineQr ? (
            <button type="button" onClick={() => setShowQr(true)} className={chip}>
              <span aria-hidden>💬</span>
              <span className="text-mute">LINE</span>
              <span className="text-fg">{line}</span>
              <span className="text-xs text-brand-400">· กดดู QR</span>
            </button>
          ) : lineUrl ? (
            <a href={lineUrl} target="_blank" rel="noreferrer" className={chip}>
              <span aria-hidden>💬</span>
              <span className="text-mute">LINE</span>
              <span className="text-fg">{line}</span>
              <span className="text-xs text-brand-400">· เพิ่มเพื่อน</span>
            </a>
          ) : (
            <span className={chip}>
              <span aria-hidden>💬</span>
              <span className="text-mute">LINE</span>
              <span className="text-fg">{line}</span>
            </span>
          )
        ) : null}

        {facebook ? (
          facebookUrl ? (
            <a href={facebookUrl} target="_blank" rel="noreferrer" className={chip}>
              <span aria-hidden>📘</span>
              <span className="text-mute">Facebook</span>
              <span className="max-w-[16rem] truncate text-fg">{facebook}</span>
              <span className="text-xs text-brand-400">↗</span>
            </a>
          ) : (
            <span className={chip}>
              <span aria-hidden>📘</span>
              <span className="text-mute">Facebook</span>
              <span className="text-fg">{facebook}</span>
            </span>
          )
        ) : null}

        {phone ? (
          <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} className={chip}>
            <span aria-hidden>📞</span>
            <span className="text-mute">โทร</span>
            <span className="text-fg">{phone}</span>
          </a>
        ) : null}
      </div>

      {note ? <p className="mt-3 text-sm text-mute">{note}</p> : null}

      {/* หน้าต่าง QR */}
      {showQr && lineQr ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setShowQr(false)}
          role="presentation"
        >
          <div
            className="w-full max-w-xs rounded-2xl border border-ink-700 bg-ink-900 p-5 text-center"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="QR Code ของ LINE"
          >
            <p className="text-sm font-medium text-fg">สแกนเพื่อเพิ่มเพื่อนใน LINE</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lineQr}
              alt="QR Code LINE ของร้าน"
              className="mx-auto mt-3 w-full max-w-[16rem] rounded-xl bg-white p-3"
            />
            <p className="mt-3 text-sm text-slate-200">{line}</p>
            <div className="mt-4 flex flex-col gap-2">
              {lineUrl ? (
                <a href={lineUrl} target="_blank" rel="noreferrer" className="btn-primary w-full">
                  เปิดแอป LINE เลย
                </a>
              ) : null}
              <button type="button" className="btn-ghost w-full" onClick={() => setShowQr(false)}>
                ปิด
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
