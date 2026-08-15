'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

const STORAGE_KEY = 'payjung.order-sound'

/**
 * เสียงกริ๊งสองจังหวะ สร้างจาก Web Audio ตอนนั้นเลย
 * ไม่ต้องมีไฟล์เสียงในโปรเจกต์ และไม่ต้องโหลดอะไรเพิ่มตอนเสียงดัง
 */
function playChime(ctx: AudioContext) {
  const now = ctx.currentTime
  for (const [freq, at] of [
    [880, 0],
    [1318.5, 0.16],
  ]) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    // ไล่ระดับเสียงแทนการเปิด-ปิดทันที ไม่งั้นจะได้ยินเสียงแตกตอนหัวและท้าย
    gain.gain.setValueAtTime(0.0001, now + at)
    gain.gain.exponentialRampToValueAtTime(0.3, now + at + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.45)
    osc.connect(gain).connect(ctx.destination)
    osc.start(now + at)
    osc.stop(now + at + 0.5)
  }
}

/**
 * เสียงแจ้งเตือนเมื่อมีออเดอร์ใหม่เข้ามาจากหน้าเว็บลูกค้า
 *
 * ถามจำนวนออเดอร์เป็นระยะ ถ้าเพิ่มขึ้นก็ส่งเสียง ขึ้นป้าย และดึงข้อมูลหน้าปัจจุบันใหม่
 * ตั้งใจให้ถามต่อแม้สลับแท็บไปทำอย่างอื่น เพราะเวลานั้นแหละที่ต้องการให้เสียงเตือน
 * แลกกับที่ต้องเปิดเองก่อนถึงจะเริ่มถาม จะได้ไม่กินโควตาของคนที่ไม่ได้ใช้
 */
export function OrderAlert({ seconds = 25 }: { seconds?: number }) {
  const router = useRouter()
  const [on, setOn] = useState(false)
  const [ready, setReady] = useState(false)
  const [fresh, setFresh] = useState(0)
  const [muted, setMuted] = useState(false)

  const total = useRef<number | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const baseTitle = useRef('')

  const audioContext = useCallback(() => {
    if (!ctxRef.current) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return null
      ctxRef.current = new Ctor()
    }
    return ctxRef.current
  }, [])

  const ring = useCallback(() => {
    const ctx = audioContext()
    if (!ctx) return
    // เบราว์เซอร์จะพักระบบเสียงไว้จนกว่าจะมีคนแตะหน้าจอ หลังรีเฟรชหน้าจึงต้องปลุกก่อน
    if (ctx.state === 'suspended') {
      void ctx.resume().then(
        () => {
          setMuted(false)
          playChime(ctx)
        },
        () => setMuted(true)
      )
      return
    }
    playChime(ctx)
  }, [audioContext])

  useEffect(() => {
    baseTitle.current = document.title
    setOn(localStorage.getItem(STORAGE_KEY) === '1')
    setReady(true)
  }, [])

  // หลังโหลดหน้าใหม่ระบบเสียงจะถูกพักไว้ รอจังหวะที่คนกดอะไรสักอย่างแล้วค่อยปลุก
  useEffect(() => {
    if (!on) return
    function wake() {
      const ctx = ctxRef.current
      if (ctx?.state === 'suspended') void ctx.resume().then(() => setMuted(false))
    }
    document.addEventListener('pointerdown', wake)
    document.addEventListener('keydown', wake)
    return () => {
      document.removeEventListener('pointerdown', wake)
      document.removeEventListener('keydown', wake)
    }
  }, [on])

  useEffect(() => {
    if (!on) return
    let alive = true

    async function check() {
      try {
        const res = await fetch('/api/new-orders', { cache: 'no-store' })
        if (!res.ok || !alive) return
        const data = (await res.json()) as { total: number; pending: number }
        if (!alive || typeof data.total !== 'number') return

        const before = total.current
        total.current = data.total
        // รอบแรกแค่จำตัวเลขไว้ ยังไม่ต้องเตือน ไม่งั้นจะดังทุกครั้งที่เปิดหน้า
        if (before === null || data.total <= before) return

        setFresh((n) => n + (data.total - before))
        ring()
        router.refresh()
      } catch {
        // เน็ตสะดุดหรือเซิร์ฟเวอร์ไม่ว่าง ข้ามรอบนี้ไปเงียบ ๆ แล้วลองใหม่รอบหน้า
      }
    }

    void check()
    const timer = setInterval(check, seconds * 1000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [on, seconds, ring, router])

  // ขึ้นจำนวนบนแท็บเบราว์เซอร์ด้วย เผื่อสลับไปทำอย่างอื่นแล้วไม่ได้ยินเสียง
  useEffect(() => {
    if (!baseTitle.current) return
    document.title = fresh > 0 ? `(${fresh}) ${baseTitle.current}` : baseTitle.current
  }, [fresh])

  function toggle() {
    const next = !on
    setOn(next)
    localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
    if (next) {
      // กดปุ่มนี้คือการแตะหน้าจอที่เบราว์เซอร์รอ ถือโอกาสปลุกระบบเสียงและลองเสียงให้ฟังเลย
      const ctx = audioContext()
      if (ctx) {
        void ctx.resume().then(
          () => {
            setMuted(false)
            playChime(ctx)
          },
          () => setMuted(true)
        )
      }
    } else {
      total.current = null
      setFresh(0)
    }
  }

  // ยังอ่านค่าที่เคยเลือกไว้ไม่เสร็จ เว้นที่ไว้เท่าเดิมกันหน้าเด้ง
  if (!ready) return <div className="h-8" />

  return (
    <div className="flex items-center gap-2">
      {fresh > 0 ? (
        <button
          type="button"
          onClick={() => setFresh(0)}
          className="animate-pulse rounded-lg border border-good/50 bg-good/15 px-2.5 py-1.5 text-xs font-medium text-good"
          title="กดเพื่อล้างป้าย"
        >
          🛒 ออเดอร์ใหม่ {fresh} รายการ
        </button>
      ) : null}

      {on && muted ? (
        <span className="rounded-lg border border-warn/50 bg-warn/10 px-2.5 py-1.5 text-xs text-warn">
          แตะหน้าจอสักครั้งเพื่อให้เสียงดังได้
        </span>
      ) : null}

      <button
        type="button"
        onClick={toggle}
        className={`rounded-lg border px-2.5 py-1.5 text-xs transition ${
          on
            ? 'border-brand-500/50 bg-brand-600/20 text-brand-300'
            : 'border-ink-700 bg-ink-850 text-mute hover:text-slate-200'
        }`}
        title={
          on
            ? 'ปิดเสียงแจ้งเตือนออเดอร์จากหน้าเว็บ'
            : 'เปิดเสียงแจ้งเตือนเมื่อมีออเดอร์ใหม่จากหน้าเว็บ'
        }
      >
        {on ? '🔔 เสียงแจ้งเตือน: เปิด' : '🔕 เสียงแจ้งเตือน: ปิด'}
      </button>
    </div>
  )
}
