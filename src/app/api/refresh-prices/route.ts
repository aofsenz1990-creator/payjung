import { NextResponse, type NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { tooMany } from '@/lib/ratelimit'
import {
  notifyRun,
  recordRefreshRun,
  refreshAllSellingPrices,
  summarizeRun,
} from '@/lib/priceRefresh'
import { publicOrigin } from '@/lib/siteUrl'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * งบเวลาของหนึ่งรอบ — ต้องต่ำกว่าเพดาน 60 วินาทีของ Vercel พอสมควร
 * เผื่อเวลาไว้เขียนสรุปลงฐานข้อมูลและส่ง LINE หลังงานหลักจบ
 * ถ้าโดนตัดกลางคัน ของที่ทำมาทั้งรอบหายและไม่มีใครรู้ว่าราคาไม่ได้อัปเดต
 */
const BUDGET_MS = 45_000

/** กันวนไม่จบถ้ามีเจ้าที่ทำเท่าไรก็ไม่เสร็จ */
const MAX_ROUNDS = 6

/**
 * อัปเดตราคาทุนของทุกเจ้าที่มีของขายอยู่บนเว็บ — วันละครั้ง
 *
 * Vercel เป็นคนเรียกตามเวลาที่ตั้งไว้ใน vercel.json
 * ถ้าตั้ง CRON_SECRET ไว้ Vercel จะแนบมาให้ในหัวข้อ Authorization เอง — ตรวจตัวนั้นก่อน
 * ถ้ายังไม่ได้ตั้ง ก็ยังทำงานได้แต่จำกัดไว้ 2 ครั้งต่อชั่วโมง
 * เพื่อไม่ให้ใครที่เดา URL เจอมากดยิงรัวจนไปเบียดเพดานการยิงของผู้ให้บริการ
 *
 * ผู้ดูแลระบบเปิด /api/refresh-prices เองเพื่อสั่งรันทันทีก็ได้
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')

  const user = await getSession().catch(() => null)
  const isAdmin = user?.role === 'admin'
  const fromCron = Boolean(secret) && auth === `Bearer ${secret}`

  if (secret) {
    if (!fromCron && !isAdmin) {
      return NextResponse.json({ error: 'not found' }, { status: 404 })
    }
  } else if (!isAdmin) {
    if (await tooMany('refresh-prices', 2, 3600)) {
      return NextResponse.json({ error: 'too many' }, { status: 429 })
    }
  }

  const url = new URL(request.url)
  const round = Math.max(1, Number(url.searchParams.get('round')) || 1)
  // รอบต่อ ๆ ไปจะบอกมาว่าเหลือเจ้าไหนที่ยังไม่ได้ทำ
  const only = (url.searchParams.get('only') ?? '')
    .split(',')
    .map((v) => Number(v.trim()))
    .filter((n) => Number.isInteger(n) && n > 0)

  try {
    const run = await refreshAllSellingPrices({
      deadline: Date.now() + BUDGET_MS,
      only: only.length > 0 ? only : null,
    })

    // ยังเหลือเจ้าที่ทำไม่ทัน — จุดรอบถัดไปให้ทำต่อ ไม่ต้องรอถึงพรุ่งนี้
    let chained = false
    if (run.pending.length > 0 && round < MAX_ROUNDS) {
      chained = await continueLater(run.pending, round + 1, secret)
    }

    const complete = run.pending.length === 0 && run.results.every((r) => r.ok)
    const text =
      summarizeRun(run) +
      (run.pending.length > 0 ? (chained ? ' · กำลังทำต่อรอบถัดไป' : ' · หยุดค้างไว้') : '')

    await recordRefreshRun(text, complete)
    await notifyRun(run, { chained })

    return NextResponse.json(
      { ok: complete, round, summary: text, results: run.results },
      { headers: { 'cache-control': 'no-store' } }
    )
  } catch (err) {
    // ล้มทั้งรอบ = ราคาทุนไม่ได้อัปเดตเลย ต้องจดไว้ให้เห็นในหลังร้าน
    const message = err instanceof Error ? err.message : String(err)
    await recordRefreshRun(`รอบอัตโนมัติล้มเหลว: ${message}`, false)
    return NextResponse.json({ error: 'unavailable' }, { status: 500 })
  }
}

/**
 * จุดรอบถัดไปให้ทำต่อจากที่ค้าง
 *
 * ยิงแล้วตัดสายเองหลังสองวินาที — ถ้ารอจนได้คำตอบคือรอให้รอบถัดไปทำงานจนจบ
 * ซึ่งเกินเวลาที่รอบนี้เหลืออยู่แน่นอน แล้วรอบนี้จะโดน Vercel ตัดทิ้งไปด้วย
 * (การตัดสายฝั่งเราไม่ได้หยุดฟังก์ชันที่ถูกจุดไปแล้ว)
 *
 * ต้องมี CRON_SECRET ไม่งั้นรอบถัดไปจะเข้าไม่ได้ — คืน false เพื่อให้รายงานบอกความจริง
 */
async function continueLater(pending: number[], round: number, secret?: string) {
  if (!secret) return false
  const origin = await publicOrigin()
  if (!origin) return false

  const url = `${origin}/api/refresh-prices?round=${round}&only=${pending.join(',')}`
  try {
    await fetch(url, {
      headers: { authorization: `Bearer ${secret}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(2_000),
    })
    return true
  } catch (err) {
    // ครบสองวินาทีแล้วเราตัดเอง = ปกติ แปลว่ารอบถัดไปรับงานไปแล้ว
    const name = err instanceof Error ? err.name : ''
    return name === 'TimeoutError' || name === 'AbortError'
  }
}
