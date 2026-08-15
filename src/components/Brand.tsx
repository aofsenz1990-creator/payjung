'use client'

import { useEffect, useRef, useState } from 'react'

/** เครื่องหมาย P แบบไล่สีชมพู→ม่วง ใช้เป็นตัวสำรองเวลาไม่มีไฟล์โลโก้ และเป็น favicon */
export function BrandMark({ size = 36, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="Pay Jung"
    >
      <defs>
        <linearGradient id="brandMarkGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--color-brand-500)" />
          <stop offset="100%" stopColor="var(--color-grape-500)" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#brandMarkGrad)" />
      <path d="M22 46V18h11.5c6.6 0 10.5 3.8 10.5 9.6 0 5.9-3.9 9.7-10.5 9.7H29.5V46z" fill="#fff" />
      <circle cx="33" cy="27.4" r="3.2" fill="url(#brandMarkGrad)" />
    </svg>
  )
}

/** ตัวอักษร Pay Jung ตามสีโลโก้ ใช้คู่กับ BrandMark ตอนไม่มีไฟล์โลโก้ */
export function BrandWordmark({ subtitle = true }: { subtitle?: boolean }) {
  return (
    <span className="min-w-0">
      <span className="block text-base font-bold leading-tight">
        <span className="text-brand-400">Pay</span> <span className="text-grape-400">Jung</span>
      </span>
      {subtitle ? (
        <span className="block text-[11px] leading-tight text-mute">ระบบจัดการร้านเติมเกม</span>
      ) : null}
    </span>
  )
}

/**
 * โลโก้ร้านจากไฟล์ public/logo.png (พื้นหลังโปร่งใส)
 * ถ้าไม่มีไฟล์ จะสลับไปใช้เครื่องหมาย P + ตัวอักษรอัตโนมัติ
 */
export function BrandLogo({
  className = 'w-56 sm:w-64',
  compactFallback = false,
  circle = false,
  size = 128,
}: {
  className?: string
  compactFallback?: boolean
  /** แสดงเป็นวงกลมพื้นขาว */
  circle?: boolean
  /** ขนาดวงกลมเป็นพิกเซล ใช้เมื่อ circle = true */
  size?: number
}) {
  const [failed, setFailed] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)

  // เบราว์เซอร์อาจโหลดรูปไม่สำเร็จตั้งแต่ก่อน React hydrate ทำให้ onError ไม่ทำงาน
  // จึงต้องเช็กสถานะรูปอีกครั้งตอน mount
  useEffect(() => {
    const img = imgRef.current
    if (img && img.complete && img.naturalWidth === 0) setFailed(true)
  }, [])

  if (circle && !failed) {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white shadow-lg shadow-black/30 ring-1 ring-white/20"
        style={{ width: size, height: size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src="/logo.png"
          alt="Pay Jung — ระบบจัดการร้านเติมเกม"
          width={836}
          height={675}
          className="object-contain"
          style={{ width: size * 0.82, height: size * 0.82 }}
          onError={() => setFailed(true)}
        />
      </span>
    )
  }

  if (failed) {
    if (compactFallback) {
      return (
        <span className="flex items-center gap-2.5">
          <BrandMark size={36} />
          <BrandWordmark />
        </span>
      )
    }
    return (
      <span className="flex flex-col items-center gap-3">
        <BrandMark size={64} />
        <span className="text-xl font-bold">
          <span className="text-brand-400">Pay</span> <span className="text-grape-400">Jung</span>
        </span>
      </span>
    )
  }

  return (
    // ใช้ img ธรรมดาเพื่อให้ตกกลับไปใช้โลโก้สำรองได้เมื่อไฟล์หาย
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imgRef}
      src="/logo.png"
      alt="Pay Jung — ระบบจัดการร้านเติมเกม"
      width={836}
      height={675}
      className={`block h-auto ${className}`}
      onError={() => setFailed(true)}
    />
  )
}
