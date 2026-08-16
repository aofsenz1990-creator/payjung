import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { q } from '@/lib/db'
import { syncPendingSales } from '@/lib/dispatch'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * ตัวเลขสำหรับเสียงแจ้งเตือนออเดอร์จากหน้าเว็บ
 * คืนแค่จำนวน ไม่มีรายละเอียดออเดอร์หรือข้อมูลลูกค้าออกไป
 * และต้องเป็นคนของร้านเท่านั้นถึงจะเรียกได้
 *
 * ตรงนี้เป็นจังหวะที่ระบบใช้ตามสถานะออเดอร์กับผู้ให้บริการไปด้วย
 * เพราะหน้าแดชบอร์ดเรียกทุก 10 วินาทีอยู่แล้วตอนที่พนักงานเปิดหน้าเว็บทิ้งไว้
 * จึงไม่ต้องใช้ Vercel Cron (ซึ่งแพ็กเกจฟรีรันได้แค่วันละครั้ง)
 */
export async function GET() {
  const user = await getSession()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // ตามสถานะก่อน แล้วค่อยนับ ตัวเลขที่ส่งกลับจะได้เป็นค่าล่าสุดจริง ๆ
  // ถ้าปลายทางไม่ตอบก็ข้ามไป ไม่ให้เสียงแจ้งเตือนพังตาม
  try {
    await syncPendingSales()
  } catch {
    // ไม่ต้องทำอะไร รอบหน้าลองใหม่
  }

  try {
    const rows = await q<{ total: number; pending: number; attention: number }>(
      `select count(*)::int as total,
              count(*) filter (where status = 'pending')::int as pending,
              count(*) filter (where provider_state in ('error', 'manual'))::int as attention
         from sales where channel = 'web'`
    )
    const row = rows[0] ?? { total: 0, pending: 0, attention: 0 }
    return NextResponse.json(row, { headers: { 'cache-control': 'no-store' } })
  } catch {
    // ฐานข้อมูลมีปัญหาชั่วคราว — ฝั่งหน้าเว็บจะข้ามรอบนี้ไปเงียบ ๆ แล้วลองใหม่รอบหน้า
    return NextResponse.json({ error: 'unavailable' }, { status: 503 })
  }
}
