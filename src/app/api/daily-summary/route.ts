import { NextResponse, type NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { sendDailySummary } from '@/lib/dailySummary'
import { tooMany } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * ส่งสรุปยอดขายประจำวันเข้า LINE
 *
 * Vercel เป็นคนเรียกตามเวลาที่ตั้งไว้ใน vercel.json
 * ถ้าตั้ง CRON_SECRET ไว้ Vercel จะแนบมาให้ในหัวข้อ Authorization เอง — ตรวจตัวนั้นก่อน
 * ถ้ายังไม่ได้ตั้ง ก็ยังทำงานได้แต่จำกัดไว้ 2 ครั้งต่อชั่วโมง
 * เพื่อไม่ให้ใครที่เดา URL เจอมากดยิงรัวจนสแปม LINE ของร้าน
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')

  // ผู้ดูแลระบบกดทดสอบเองจากหลังร้านได้ด้วย
  const user = await getSession().catch(() => null)
  const isAdmin = user?.role === 'admin'

  if (secret) {
    if (auth !== `Bearer ${secret}` && !isAdmin) {
      return NextResponse.json({ error: 'not found' }, { status: 404 })
    }
  } else if (!isAdmin) {
    if (await tooMany('daily-summary', 2, 3600)) {
      return NextResponse.json({ error: 'too many' }, { status: 429 })
    }
  }

  try {
    const { sent } = await sendDailySummary()
    return NextResponse.json({ ok: sent }, { headers: { 'cache-control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'unavailable' }, { status: 500 })
  }
}
