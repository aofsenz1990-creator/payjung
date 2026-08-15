'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * แบนเนอร์ด้านบนสุดของหน้าเว็บลูกค้า
 * ถ้าไม่มีไฟล์ภาพจะไม่แสดงอะไรเลย (ไม่ขึ้นรูปเสีย) เพราะเป็นของตกแต่ง ไม่ใช่ของจำเป็น
 */
export function ShopCover({ src }: { src: string }) {
  const [failed, setFailed] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)

  // เบราว์เซอร์อาจโหลดรูปไม่สำเร็จตั้งแต่ก่อน React hydrate ทำให้ onError ไม่ทำงาน
  useEffect(() => {
    const img = imgRef.current
    if (img && img.complete && img.naturalWidth === 0) setFailed(true)
  }, [])

  if (failed) return null

  return (
    <div className="relative z-10 w-full overflow-hidden border-b border-ink-800/60">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={src}
        alt="Pay Jung"
        className="h-24 w-full object-cover object-center sm:h-32 lg:h-40"
        onError={() => setFailed(true)}
      />
    </div>
  )
}
