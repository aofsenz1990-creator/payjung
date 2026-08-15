import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { q } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

/**
 * ตัวเลขสำหรับเสียงแจ้งเตือนออเดอร์จากหน้าเว็บ
 * คืนแค่จำนวน ไม่มีรายละเอียดออเดอร์หรือข้อมูลลูกค้าออกไป
 * และต้องเป็นคนของร้านเท่านั้นถึงจะเรียกได้
 */
export async function GET() {
  const user = await getSession()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const rows = await q<{ total: number; pending: number }>(
      `select count(*)::int as total,
              count(*) filter (where status = 'pending')::int as pending
         from sales where channel = 'web'`
    )
    const row = rows[0] ?? { total: 0, pending: 0 }
    return NextResponse.json(row, { headers: { 'cache-control': 'no-store' } })
  } catch {
    // ฐานข้อมูลมีปัญหาชั่วคราว — ฝั่งหน้าเว็บจะข้ามรอบนี้ไปเงียบ ๆ แล้วลองใหม่รอบหน้า
    return NextResponse.json({ error: 'unavailable' }, { status: 503 })
  }
}
