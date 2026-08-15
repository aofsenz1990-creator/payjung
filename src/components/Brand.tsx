'use client'

import { useEffect, useRef, useState } from 'react'

/** เครื่องหมาย P แบบไล่สีชมพู→ม่วง ใช้ในเมนูและเป็นตัวสำรองเวลาไม่มีไฟล์โลโก้ */
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

/** ตัวอักษร Pay Jung ตามสีโลโก้ */
export function BrandWordmark({ subtitle = true }: { subtitle?: boolean }) {
  return (
    <span>
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
 * โลโก้เต็มใบสำหรับหน้าเข้าสู่ระบบ
 * ไฟล์โลโก้เป็นพื้นหลังสีขาว จึงวางบนการ์ดสีขาวให้ดูตั้งใจ
 * ถ้ายังไม่มีไฟล์ public/logo.png จะสลับไปใช้เครื่องหมาย P อัตโนมัติ
 */
export function BrandLogo() {
  const [failed, setFailed] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)

  // เบราว์เซอร์อาจโหลดรูปไม่สำเร็จตั้งแต่ก่อน React hydrate ทำให้ onError ไม่ทำงาน
  // จึงต้องเช็กสถานะรูปอีกครั้งตอน mount
  useEffect(() => {
    const img = imgRef.current
    if (img && img.complete && img.naturalWidth === 0) setFailed(true)
  }, [])

  if (failed) {
    return (
      <div className="mx-auto mb-5 flex flex-col items-center gap-3">
        <BrandMark size={64} />
        <span className="text-xl font-bold">
          <span className="text-brand-400">Pay</span> <span className="text-grape-400">Jung</span>
        </span>
      </div>
    )
  }

  return (
    <div className="mx-auto mb-5 w-fit rounded-3xl bg-white p-3 shadow-lg shadow-black/40 ring-1 ring-white/10">
      {/* ใช้ img ธรรมดาเพื่อให้ตกกลับไปใช้โลโก้สำรองได้เมื่อไฟล์หาย */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src="/logo.png"
        alt="Pay Jung — ระบบจัดการร้านเติมเกม"
        width={200}
        height={200}
        className="block size-40 object-contain sm:size-48"
        onError={() => setFailed(true)}
      />
    </div>
  )
}
