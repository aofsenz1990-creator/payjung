'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

const MAX_DIMENSION = 1600
const JPEG_QUALITY = 0.82

/** ย่อรูปฝั่งเบราว์เซอร์ก่อนส่ง สลิปจากมือถือมักใหญ่หลาย MB ย่อแล้วเหลือไม่กี่ร้อย KB */
async function toResizedDataUrl(blob: Blob) {
  const bitmap = await createImageBitmap(blob)
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('เบราว์เซอร์นี้ประมวลผลรูปไม่ได้')
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()

  return { dataUrl: canvas.toDataURL('image/jpeg', JPEG_QUALITY), width, height }
}

/**
 * ช่องแนบสลิปโอนเงิน — วางด้วย Ctrl+V ได้ทั้งหน้า ลากไฟล์มาวางก็ได้ หรือกดเลือกไฟล์
 * ส่งค่าเป็น data URL ผ่าน input ที่ซ่อนไว้ ชื่อ slip_data
 */
export function SlipInput({ onChange }: { onChange?: (hasSlip: boolean) => void }) {
  const [dataUrl, setDataUrl] = useState('')
  const [info, setInfo] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const accept = useCallback(
    async (blob: Blob | undefined | null) => {
      if (!blob) return
      if (!blob.type.startsWith('image/')) {
        setError('ไฟล์ที่วางไม่ใช่รูปภาพ')
        return
      }
      setBusy(true)
      setError('')
      try {
        const { dataUrl: url, width, height } = await toResizedDataUrl(blob)
        setDataUrl(url)
        const kb = Math.round((url.length * 0.75) / 1024)
        setInfo(`${width}×${height} px · ~${kb} KB`)
        onChange?.(true)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'อ่านรูปไม่สำเร็จ')
      } finally {
        setBusy(false)
      }
    },
    [onChange]
  )

  // ดักการวางทั้งหน้า จะได้กด Ctrl+V ได้เลยโดยไม่ต้องคลิกที่ช่องก่อน
  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      const item = Array.from(event.clipboardData?.items ?? []).find((i) =>
        i.type.startsWith('image/')
      )
      if (!item) return
      event.preventDefault()
      void accept(item.getAsFile())
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [accept])

  function clear() {
    setDataUrl('')
    setInfo('')
    setError('')
    if (fileRef.current) fileRef.current.value = ''
    onChange?.(false)
  }

  return (
    <div>
      <span className="label">
        สลิปโอนเงิน <span className="text-bad">*</span>
      </span>

      <input type="hidden" name="slip_data" value={dataUrl} />

      {dataUrl ? (
        <div className="rounded-xl border border-good/40 bg-good/5 p-3">
          <div className="flex items-start gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={dataUrl}
              alt="สลิปโอนเงินที่แนบ"
              className="h-32 w-24 rounded-lg border border-ink-700 object-cover"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-good">✓ แนบสลิปแล้ว</p>
              <p className="mt-1 text-xs text-mute">{info}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="btn-ghost btn-sm" onClick={clear}>
                  เอาออก
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => fileRef.current?.click()}
                >
                  เปลี่ยนรูป
                </button>
                <a
                  href={dataUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-ghost btn-sm"
                >
                  ดูเต็มจอ
                </a>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            void accept(e.dataTransfer.files?.[0])
          }}
          onClick={() => fileRef.current?.click()}
          className={`cursor-pointer rounded-xl border border-dashed px-4 py-6 text-center transition ${
            dragging
              ? 'border-brand-500 bg-brand-500/10'
              : error
                ? 'border-bad/50 bg-bad/5'
                : 'border-ink-600 bg-ink-850 hover:border-brand-500/60'
          }`}
        >
          <p className="text-2xl">{busy ? '⏳' : '🧾'}</p>
          <p className="mt-1.5 text-sm font-medium text-slate-200">
            {busy ? 'กำลังอ่านรูป...' : 'กด Ctrl + V เพื่อวางสลิป'}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-mute">
            แคปหน้าจอสลิปแล้ววางได้เลย หรือลากไฟล์มาวาง / คลิกเพื่อเลือกไฟล์
          </p>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void accept(e.target.files?.[0])}
      />

      {error ? <p className="mt-2 text-xs text-bad">{error}</p> : null}
    </div>
  )
}
