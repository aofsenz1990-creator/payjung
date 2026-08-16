import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { applyCallback } from '@/lib/dispatch'
import { mapStatus } from '@/lib/providers/overtopup'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

/**
 * รับผลออเดอร์ที่ผู้ให้บริการยิงกลับมา (ตอนนี้ใช้กับ OverTopup)
 *
 * เป็น endpoint สาธารณะ เพราะผู้ให้บริการยิงเข้ามาโดยไม่มี session
 * ตัวยืนยันตัวตนคือกุญแจลับใน path — ต้องตรงกับ PROVIDER_CALLBACK_SECRET เท่านั้น
 * ถ้าไม่ตั้งกุญแจไว้ จะปิดรับทั้งหมด แล้วระบบใช้วิธีตามสถานะเองแทน
 *
 * ทำไมต้องมีกุญแจ: ถ้าใครก็ยิงเข้ามาได้ จะปลอมสถานะ "เติมสำเร็จ" ให้บิลไหนก็ได้
 * = ได้ของฟรีโดยที่ร้านไม่รู้ตัว
 */

/** เทียบแบบใช้เวลาคงที่ กันการเดาคีย์ทีละตัวจากเวลาที่ตอบกลับ */
function sameSecret(given: string, expected: string) {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const secret = process.env.PROVIDER_CALLBACK_SECRET
  const { token } = await params

  // ไม่ตั้งกุญแจ = ไม่เปิดรับ (ตอบเหมือนไม่มีหน้านี้ ไม่บอกใบ้ว่ามีระบบอยู่)
  if (!secret || !sameSecret(token, secret)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  // OverTopup ส่งมาเป็น form-urlencoded แต่เผื่อเจ้าอื่นส่ง JSON ไว้ด้วย
  let fields: Record<string, string> = {}
  try {
    const type = request.headers.get('content-type') ?? ''
    if (type.includes('application/json')) {
      const body = (await request.json()) as Record<string, unknown>
      for (const [k, v] of Object.entries(body)) {
        if (typeof v === 'string' || typeof v === 'number') fields[k] = String(v)
      }
    } else {
      const form = await request.formData()
      fields = Object.fromEntries(
        [...form.entries()]
          .filter(([, v]) => typeof v === 'string')
          .map(([k, v]) => [k, v as string])
      )
    }
  } catch {
    return NextResponse.json({ error: 'bad body' }, { status: 400 })
  }

  const ref = fields.reference_no?.trim()
  const orderNo = fields.order_no?.trim() || null
  if (!ref) return NextResponse.json({ error: 'missing reference_no' }, { status: 400 })

  const result = mapStatus(fields.order_status, fields.note || fields.note_cancel || null, orderNo)

  try {
    const outcome = await applyCallback({ ref, orderId: orderNo, result })
    // ตอบ 200 เสมอแม้จับคู่บิลไม่ได้ ไม่งั้นปลายทางจะยิงซ้ำไม่หยุด
    return NextResponse.json({ ok: outcome.matched }, { headers: { 'cache-control': 'no-store' } })
  } catch {
    // ฐานข้อมูลมีปัญหาชั่วคราว — ตอบ 500 ให้ปลายทางลองส่งใหม่
    return NextResponse.json({ error: 'unavailable' }, { status: 500 })
  }
}
