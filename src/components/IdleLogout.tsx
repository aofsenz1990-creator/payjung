'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { shopIdleLogoutAction } from '@/lib/actions/shop'
import { SHOP_IDLE_MS, SHOP_IDLE_WARN_SECONDS } from '@/lib/idle'

/**
 * เตือนล่วงหน้ากี่มิลลิวินาที
 * ห้ามยาวเกินครึ่งหนึ่งของเวลาที่ให้ ไม่งั้นถ้าร้านตั้งเวลาไว้สั้น ๆ (เช่น 1 นาที)
 * กล่องเตือนจะขึ้นค้างตั้งแต่วินาทีแรกจนบังหน้าเว็บทั้งวัน
 */
const WARN_MS = Math.min(SHOP_IDLE_WARN_SECONDS * 1000, Math.floor(SHOP_IDLE_MS / 2))

/**
 * เคาะบอกเซิร์ฟเวอร์ทุก ๆ หนึ่งในสามของเวลาที่ให้ (แต่ไม่ถี่กว่านาทีละครั้ง)
 * ถี่พอที่เวลาฝั่งเซิร์ฟเวอร์จะไม่ตามหลังจนเตะคนที่ยังใช้งานอยู่ออก
 * และห่างพอที่จะไม่กลายเป็นยิงรีเควสต์รัวใส่ตัวเอง
 */
const KEEPALIVE_MS = Math.max(Math.round(SHOP_IDLE_MS / 3), 60_000)

/**
 * ตัวจับเวลา "ไม่มีการใช้งาน" ของหน้าเว็บลูกค้า
 *
 * ตัวนี้ทำหน้าที่เตือนล่วงหน้าและพาออกจากระบบให้เนียน ๆ ขณะที่แท็บยังเปิดอยู่
 * แต่ **ไม่ใช่ด่านความปลอดภัย** — ด่านจริงอยู่ใน middleware ฝั่งเซิร์ฟเวอร์
 * ซึ่งกันได้แม้เบราว์เซอร์จะปิด JavaScript หรือปิดแท็บทิ้งไว้ข้ามคืนแล้วเปิดใหม่
 *
 * เรนเดอร์เฉพาะตอนที่มีลูกค้าล็อกอินอยู่เท่านั้น (ดู shop/layout.tsx)
 */
export function IdleLogout() {
  // จำนวนวินาทีที่เหลือก่อนถูกพาออก — ไม่ใช่ null เมื่อไหร่ = กล่องเตือนกำลังขึ้นอยู่
  const [left, setLeft] = useState<number | null>(null)
  const [mounted, setMounted] = useState(false)

  const lastActive = useRef(Date.now())
  const lastPing = useRef(Date.now())
  const leaving = useRef(false)
  const form = useRef<HTMLFormElement>(null)

  useEffect(() => setMounted(true), [])

  /** บอกเซิร์ฟเวอร์ว่ายังอยู่ เพื่อให้เวลาสองฝั่งตรงกัน */
  const ping = useCallback(() => {
    lastPing.current = Date.now()
    // ล้มเหลวก็ปล่อยผ่าน (เน็ตหลุดชั่วคราว) ไม่มีอะไรให้ลูกค้าต้องรับรู้
    void fetch('/shop/keepalive', { method: 'POST', cache: 'no-store' }).catch(() => {})
  }, [])

  const stayIn = useCallback(() => {
    lastActive.current = Date.now()
    setLeft(null)
    ping()
  }, [ping])

  useEffect(() => {
    function touch() {
      lastActive.current = Date.now()
    }

    // ใช้เฉพาะการขยับที่ตั้งใจจริง ๆ ไม่เอา mousemove เพราะเมาส์ที่ถูกชนโดนโต๊ะ
    // ก็นับเป็นการใช้งานได้ ทั้งที่ไม่มีคนอยู่หน้าจอ
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const
    for (const name of events) {
      window.addEventListener(name, touch, { passive: true })
    }

    const timer = setInterval(() => {
      if (leaving.current) return
      const idle = Date.now() - lastActive.current

      if (idle >= SHOP_IDLE_MS) {
        leaving.current = true
        setLeft(0)
        form.current?.requestSubmit()
        return
      }

      if (idle >= SHOP_IDLE_MS - WARN_MS) {
        setLeft(Math.ceil((SHOP_IDLE_MS - idle) / 1000))
        return
      }

      setLeft((v) => (v === null ? v : null))

      // ยังขยับอยู่และห่างจากครั้งก่อนพอสมควรแล้ว — ต่ออายุฝั่งเซิร์ฟเวอร์
      if (lastActive.current > lastPing.current && Date.now() - lastPing.current >= KEEPALIVE_MS) {
        ping()
      }
    }, 1000)

    return () => {
      clearInterval(timer)
      for (const name of events) window.removeEventListener(name, touch)
    }
  }, [ping])

  const dialog =
    left === null ? null : (
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label="กำลังจะออกจากระบบอัตโนมัติ"
        className="fixed inset-0 z-[60] flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:p-4"
      >
        <div className="w-full max-w-sm rounded-t-2xl border border-warn/50 bg-ink-900 p-5 text-center shadow-2xl sm:rounded-2xl">
          <p className="text-3xl">⏳</p>
          <h2 className="mt-2 text-base font-bold text-fg">กำลังจะออกจากระบบอัตโนมัติ</h2>
          <p className="mt-2 text-sm leading-relaxed text-body">
            ไม่มีการใช้งานมาสักพักแล้ว ระบบจะพาออกจากระบบใน{' '}
            <span aria-live="polite" className="font-bold text-warn">
              {left}
            </span>{' '}
            วินาที เพื่อไม่ให้คนอื่นที่หยิบเครื่องนี้ไปใช้ต่อเอายอดเงินของคุณไปเติมเกม
          </p>
          <button type="button" onClick={stayIn} className="btn-primary mt-4 w-full">
            ใช้งานต่อ
          </button>
          <button
            type="button"
            onClick={() => {
              leaving.current = true
              form.current?.requestSubmit()
            }}
            className="btn-ghost mt-2 w-full"
          >
            ออกจากระบบเลย
          </button>
        </div>
      </div>
    )

  return (
    <>
      {/*
        ใช้ฟอร์มจริงยิง Server Action แทนการสั่งเปลี่ยนหน้าเอง
        เพราะต้องให้ฝั่งเซิร์ฟเวอร์เพิกถอน token ที่ Supabase และลบ cookie ให้เรียบร้อยจริง ๆ
      */}
      <form ref={form} action={shopIdleLogoutAction} className="hidden" aria-hidden />
      {/*
        ต้องย้ายกล่องไปไว้ใต้ body ด้วย portal
        เพราะแถบบนกับพื้นหลังของหน้าเว็บใช้ backdrop-blur ซึ่งทำให้ position: fixed
        ไปยึดกับกล่องนั้นแทนที่จะยึดกับหน้าจอ ผลคือฉากดำคลุมไม่เต็มจอ
      */}
      {mounted && dialog ? createPortal(dialog, document.body) : null}
    </>
  )
}
