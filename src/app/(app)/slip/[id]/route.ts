import { NextResponse } from 'next/server'
import { q1 } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { signedSlipUrl } from '@/lib/storage'

export const dynamic = 'force-dynamic'

/**
 * เปิดดูสลิปของบิล — ตรวจสิทธิ์ก่อน แล้วค่อยพาไปยังลิงก์ชั่วคราวของ Supabase Storage
 * ทำแบบนี้เพราะไฟล์ใน bucket ตั้งเป็นส่วนตัว เปิดตรง ๆ ไม่ได้
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession()
  if (!user) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 })
  if (!user.pages.includes('sales') && !user.pages.includes('history')) {
    return NextResponse.json({ error: 'ไม่มีสิทธิ์ดูสลิป' }, { status: 403 })
  }

  const { id } = await params
  const saleId = Number(id)
  if (!Number.isFinite(saleId)) {
    return NextResponse.json({ error: 'เลขบิลไม่ถูกต้อง' }, { status: 400 })
  }

  const sale = await q1<{ slip_path: string | null }>(
    'select slip_path from sales where id = $1',
    [saleId]
  )
  if (!sale?.slip_path) {
    return NextResponse.json({ error: 'บิลนี้ไม่มีสลิปแนบไว้' }, { status: 404 })
  }

  const url = await signedSlipUrl(sale.slip_path)
  if (!url) return NextResponse.json({ error: 'เปิดสลิปไม่สำเร็จ' }, { status: 500 })

  return NextResponse.redirect(url)
}
