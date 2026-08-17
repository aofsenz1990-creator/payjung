import { NextResponse, type NextRequest } from 'next/server'
import { q } from '@/lib/db'
import { activePairCode, lineConfig, replyLine, verifyLineSignature } from '@/lib/line'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

type LineEvent = {
  type?: string
  replyToken?: string
  message?: { type?: string; text?: string }
  source?: { type?: string; userId?: string; groupId?: string; roomId?: string }
}

/**
 * ปลายทางที่ LINE ยิงเข้ามาเมื่อมีคนทักหาบัญชีทางการของร้าน
 *
 * ใช้ทำอย่างเดียวคือ "ผูกปลายทางแจ้งเตือน" — เจ้าของร้านกดสร้างรหัส 6 หลักในหลังร้าน
 * แล้วพิมพ์รหัสนั้นทักไปหา OA ระบบจะจดไว้ว่าให้ส่งแจ้งเตือนมาที่นี่
 *
 * ข้อความอื่นทั้งหมดถูกเมินเฉย ๆ ลูกค้าที่แอดไลน์ร้านไว้จึงทักคุยได้ตามปกติ
 * โดยระบบไม่ไปยุ่งและไม่เก็บข้อความของใครทั้งนั้น
 */
export async function POST(request: NextRequest) {
  const { secret, token } = await lineConfig()

  // ยังไม่ได้ตั้งค่า = ยังไม่เปิดใช้ ตอบเหมือนไม่มีหน้านี้
  if (!secret || !token) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // ต้องอ่าน body เป็นข้อความดิบก่อน เพราะลายเซ็นคำนวณจากตัวอักษรเป๊ะ ๆ
  const raw = await request.text()
  if (!verifyLineSignature(secret, raw, request.headers.get('x-line-signature'))) {
    return NextResponse.json({ error: 'bad signature' }, { status: 401 })
  }

  let events: LineEvent[] = []
  try {
    events = (JSON.parse(raw) as { events?: LineEvent[] }).events ?? []
  } catch {
    return NextResponse.json({ ok: true })
  }

  const code = await activePairCode()

  for (const event of events) {
    if (event.type !== 'message' || event.message?.type !== 'text') continue

    const text = (event.message.text ?? '').trim()
    // ยังไม่ได้กดสร้างรหัส หรือรหัสไม่ตรง = ไม่ใช่การผูก ปล่อยผ่าน
    if (!code || text !== code) continue

    // ส่งเข้ากลุ่มได้ด้วย ถ้าอยากให้ทั้งทีมงานเห็นพร้อมกัน
    const target = event.source?.groupId ?? event.source?.userId
    if (!target) continue

    await q(
      `insert into site_settings (key, value) values ('line_target_id', $1)
       on conflict (key) do update set value = excluded.value`,
      [target]
    )
    // ใช้รหัสได้ครั้งเดียว ใช้แล้วล้างทิ้งทันที
    await q(
      `update site_settings set value = '' where key in ('line_pair_code', 'line_pair_expires')`
    )

    if (event.replyToken) {
      await replyLine(
        token,
        event.replyToken,
        'ผูกกับร้าน Pay Jung เรียบร้อยแล้ว ✅\nต่อไปมีลูกค้าแจ้งโอนเงินเข้ามา จะแจ้งเตือนที่นี่ทันที'
      )
    }
  }

  // ตอบ 200 เสมอ ไม่งั้น LINE จะปิดการใช้งาน webhook ให้อัตโนมัติเมื่อพลาดบ่อย ๆ
  return NextResponse.json({ ok: true })
}
