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

/** พักเสียงครั้งละกี่นาที ตอนที่ยังเติมให้ลูกค้าไม่ได้แต่ไม่อยากให้ดังรัว ๆ */
const SNOOZE_MINUTES = 15

function clockLabel(at: number) {
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(at))
}

/**
 * เสียงแจ้งเตือนออเดอร์จากหน้าเว็บลูกค้า
 *
 * ดังซ้ำเรื่อย ๆ ตราบใดที่ยังมีออเดอร์ค้างอยู่ หยุดเองเมื่อเติมสำเร็จ (กดรับเงินแล้ว)
 * หรือยกเลิก/คืนเครดิตไปแล้ว — ตั้งใจให้กวนจนกว่าจะจัดการเสร็จ ไม่ใช่ดังครั้งเดียวแล้วหาย
 *
 * ช่วงที่มีของค้างจะถามถี่ขึ้น เพื่อให้เสียงหยุดเร็วหลังกดรับเงิน
 * ช่วงปกติถามห่าง ๆ พอ จะได้ไม่กินโควตาเปล่า ๆ
 * และตั้งใจให้ถามต่อแม้สลับแท็บไปทำอย่างอื่น เพราะเวลานั้นแหละที่ต้องการให้เตือน
 */
export function OrderAlert({
  repeatSeconds = 10,
  idleSeconds = 25,
}: {
  repeatSeconds?: number
  idleSeconds?: number
}) {
  const router = useRouter()
  const [on, setOn] = useState(false)
  const [ready, setReady] = useState(false)
  const [fresh, setFresh] = useState(0)
  const [waiting, setWaiting] = useState(0)
  const [snoozeUntil, setSnoozeUntil] = useState(0)
  const [muted, setMuted] = useState(false)

  const total = useRef<number | null>(null)
  const snoozeRef = useRef(0)
  snoozeRef.current = snoozeUntil
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
    let timer: ReturnType<typeof setTimeout>

    async function check() {
      // ยังมีของค้าง = ถามถี่ขึ้น เสียงจะได้หยุดเร็วหลังกดรับเงิน
      let wait = idleSeconds

      try {
        const res = await fetch('/api/new-orders', { cache: 'no-store' })
        if (!alive) return
        if (res.ok) {
          const data = (await res.json()) as { total: number; pending: number }
          if (!alive) return

          if (typeof data.total === 'number' && typeof data.pending === 'number') {
            const before = total.current
            total.current = data.total
            setWaiting(data.pending)
            if (data.pending > 0) wait = repeatSeconds

            // ป้ายนับเฉพาะที่เพิ่งเข้ามา รอบแรกจึงยังไม่นับ ไม่งั้นของเก่าจะถูกนับใหม่ทุกครั้งที่เปิดหน้า
            if (before !== null && data.total > before) {
              setFresh((n) => n + (data.total - before))
              router.refresh()
            }

            // หมดเวลาพักเสียงแล้ว ล้างค่าให้ปุ่มกลับมาเป็นปกติ
            if (snoozeRef.current && Date.now() >= snoozeRef.current) setSnoozeUntil(0)

            // ส่วนเสียงดูที่ "ยังค้างอยู่ไหม" ไม่ใช่ "เพิ่งเข้ามาไหม"
            // ของค้างข้ามวันจึงยังเตือนอยู่ และรอบแรกหลังเปิดหน้าก็เตือนเลย
            if (data.pending > 0 && Date.now() >= snoozeRef.current) ring()
          }
        }
      } catch {
        // เน็ตสะดุดหรือเซิร์ฟเวอร์ไม่ว่าง ข้ามรอบนี้ไปเงียบ ๆ แล้วลองใหม่รอบหน้า
      }

      if (alive) timer = setTimeout(check, wait * 1000)
    }

    void check()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [on, repeatSeconds, idleSeconds, ring, router])

  // ขึ้นจำนวนบนแท็บเบราว์เซอร์ด้วย เผื่อสลับไปทำอย่างอื่นแล้วไม่ได้ยินเสียง
  useEffect(() => {
    if (!baseTitle.current) return

    function apply() {
      const want = fresh > 0 ? `(${fresh}) ${baseTitle.current}` : baseTitle.current
      if (document.title !== want) document.title = want
    }
    apply()

    // ทุกครั้งที่ดึงข้อมูลหน้าใหม่ Next จะสร้างแท็ก title ใหม่ทับของเดิม
    // ต้องดูทั้ง head ไม่ใช่ดูที่แท็กเดิม เพราะแท็กเดิมถูกถอดออกไปแล้ว
    const observer = new MutationObserver(apply)
    observer.observe(document.head, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
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
      setWaiting(0)
      setSnoozeUntil(0)
    }
  }

  // ยังอ่านค่าที่เคยเลือกไว้ไม่เสร็จ เว้นที่ไว้เท่าเดิมกันหน้าเด้ง
  if (!ready) return <div className="h-8" />

  const snoozing = snoozeUntil > Date.now()

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
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

      {on && waiting > 0 ? (
        <span className="rounded-lg border border-warn/50 bg-warn/10 px-2.5 py-1.5 text-xs font-medium text-warn">
          ⏳ ยังไม่ได้เติม {waiting} รายการ
          {snoozing ? <span className="ml-1 text-mute">· พักเสียงถึง {clockLabel(snoozeUntil)}</span> : null}
        </span>
      ) : null}

      {on && waiting > 0 && !snoozing ? (
        <button
          type="button"
          onClick={() => setSnoozeUntil(Date.now() + SNOOZE_MINUTES * 60_000)}
          className="rounded-lg border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-xs text-mute transition hover:text-slate-200"
          title={`หยุดเสียง ${SNOOZE_MINUTES} นาที แต่ยังนับออเดอร์ให้อยู่`}
        >
          😴 พักเสียง {SNOOZE_MINUTES} นาที
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
            : `เปิดเสียงแจ้งเตือน — จะดังซ้ำทุก ${repeatSeconds} วินาที จนกว่าจะเติมให้ลูกค้าเสร็จ`
        }
      >
        {on ? '🔔 เสียงแจ้งเตือน: เปิด' : '🔕 เสียงแจ้งเตือน: ปิด'}
      </button>
    </div>
  )
}
