'use client'

import { useState } from 'react'

export type ShopMessage = {
  id: number
  kind: string
  title: string | null
  body: string
  sale_code: string | null
  created_at: string
  unread: boolean
}

/**
 * ปุ่มคัดลอกโค้ด — โค้ดบัตรเติมเกมมักยาวและมีตัวอักษรคล้ายกัน (0 กับ O, 1 กับ l)
 * ให้พิมพ์ตามเองคือที่มาของเรื่องร้องเรียน "เติมไม่ได้" ที่จริง ๆ แล้วแค่พิมพ์ผิด
 */
function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <button
      type="button"
      className={copied ? 'btn-ghost btn-sm text-good' : 'btn-ghost btn-sm'}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        } catch {
          // เบราว์เซอร์เก่าบางตัวไม่ให้คัดลอกอัตโนมัติ — ลูกค้ายังลากเลือกเองได้อยู่
        }
      }}
    >
      {copied ? '✓ คัดลอกแล้ว' : 'คัดลอก'}
    </button>
  )
}

export function MessageBox({ messages }: { messages: ShopMessage[] }) {
  if (messages.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-ink-700/70 bg-ink-900/40 px-4 py-8 text-center text-sm text-mute backdrop-blur-sm">
        ยังไม่มีข้อความจากร้าน
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {messages.map((m) => {
        const isCode = m.kind === 'code'
        return (
          <article
            key={m.id}
            className={`rounded-2xl border p-4 backdrop-blur-sm ${
              m.unread
                ? 'border-brand-500/60 bg-brand-500/5'
                : 'border-ink-700/70 bg-ink-900/70'
            }`}
          >
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {m.unread ? (
                <span className="chip bg-brand-500/15 text-brand-400">ใหม่</span>
              ) : null}
              <h3 className="font-medium text-fg">
                {m.title || (isCode ? 'โค้ดสินค้าของคุณ' : 'ข้อความจากร้าน')}
              </h3>
              {m.sale_code ? (
                <span className="font-mono text-xs text-mute">บิล {m.sale_code}</span>
              ) : null}
            </div>

            {isCode ? (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-ink-700/70 bg-ink-950/60 px-3 py-2">
                <code className="min-w-0 flex-1 break-all font-mono text-sm text-brand-400 select-all">
                  {m.body}
                </code>
                <CopyButton value={m.body} />
              </div>
            ) : (
              <p className="whitespace-pre-line text-sm leading-relaxed text-slate-200">
                {m.body}
              </p>
            )}

            <p className="mt-2 text-xs text-mute">{m.created_at}</p>
          </article>
        )
      })}
    </div>
  )
}
