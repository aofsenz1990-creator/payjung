'use client'

import { useEffect, useRef, useState } from 'react'

const MAX_DIMENSION = 800
const JPEG_QUALITY = 0.85

/**
 * ย่อรูปฝั่งเบราว์เซอร์ก่อนส่ง รูปเกมไม่ต้องใหญ่มาก
 *
 * รูป PNG/WebP เก็บเป็น PNG ต่อ เพราะโลโก้เกมมักมีพื้นหลังโปร่งใส
 * ถ้าแปลงเป็น JPEG พื้นโปร่งจะกลายเป็นสีดำทับโลโก้
 */
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

  const keepAlpha = blob.type === 'image/png' || blob.type === 'image/webp'
  return keepAlpha ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', JPEG_QUALITY)
}

/**
 * ช่องใส่รูป — อัปโหลดจากเครื่อง ลากมาวาง หรือวางด้วย Ctrl+V ก็ได้
 * ถ้ามีลิงก์รูปอยู่แล้วก็วางลิงก์ตรง ๆ ได้เหมือนเดิม
 */
export function ImageInput({
  name = 'image_data',
  urlName = 'image_url',
  currentUrl,
  label = 'รูปภาพ',
  hint,
}: {
  name?: string
  urlName?: string
  currentUrl?: string | null
  label?: string
  hint?: string
}) {
  const [dataUrl, setDataUrl] = useState('')
  const [url, setUrl] = useState(currentUrl ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  const preview = dataUrl || url

  async function accept(blob: Blob | undefined | null) {
    if (!blob) return
    if (!blob.type.startsWith('image/')) {
      setError('ไฟล์ที่เลือกไม่ใช่รูปภาพ')
      return
    }
    setBusy(true)
    setError('')
    try {
      setDataUrl(await toResizedDataUrl(blob))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'อ่านรูปไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  // วางรูปได้เมื่อเมาส์อยู่ในกรอบนี้ จะได้ไม่ชนกับช่องวางสลิปในหน้าอื่น
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    function onPaste(event: ClipboardEvent) {
      const item = Array.from(event.clipboardData?.items ?? []).find((i) =>
        i.type.startsWith('image/')
      )
      if (!item) return
      event.preventDefault()
      void accept(item.getAsFile())
    }
    box.addEventListener('paste', onPaste as EventListener)
    return () => box.removeEventListener('paste', onPaste as EventListener)
  }, [])

  return (
    <div ref={boxRef} tabIndex={-1}>
      <span className="label">{label}</span>
      <input type="hidden" name={name} value={dataUrl} />

      <div className="flex gap-3">
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
          className={`flex size-24 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed transition ${
            dragging ? 'border-brand-500 bg-brand-500/10' : 'border-ink-600 bg-ink-850 hover:border-brand-500/60'
          }`}
        >
          {busy ? (
            <span className="text-xl">⏳</span>
          ) : preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="ตัวอย่างรูป" className="size-full object-contain p-1" />
          ) : (
            <span className="text-center text-xs leading-tight text-mute">
              คลิก
              <br />
              เลือกรูป
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <input
            name={urlName}
            className="input"
            value={dataUrl ? '' : url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="หรือวางลิงก์รูป https://..."
            disabled={Boolean(dataUrl)}
          />
          <p className="mt-1.5 text-xs leading-relaxed text-mute">
            {dataUrl
              ? 'จะอัปโหลดรูปที่เลือกตอนกดบันทึก'
              : (hint ?? 'คลิกที่กรอบเพื่อเลือกไฟล์ ลากรูปมาวาง หรือคลิกกรอบแล้วกด Ctrl+V')}
          </p>
          {dataUrl || url ? (
            <button
              type="button"
              className="btn-ghost btn-sm mt-2"
              onClick={() => {
                setDataUrl('')
                setUrl('')
                if (fileRef.current) fileRef.current.value = ''
              }}
            >
              เอารูปออก
            </button>
          ) : null}
        </div>
      </div>

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
