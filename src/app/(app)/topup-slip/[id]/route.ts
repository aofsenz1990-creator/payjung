import { NextResponse } from 'next/server'
import { q1 } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { signedSlipUrl } from '@/lib/storage'

export const dynamic = 'force-dynamic'

/** เปิดดูสลิปที่ลูกค้าแนบมาตอนแจ้งเติมเครดิต — เฉพาะคนที่มีสิทธิ์เมนูอนุมัติ */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession()
  if (!user) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 })
  if (!user.pages.includes('topups')) {
    return NextResponse.json({ error: 'ไม่มีสิทธิ์ดูสลิป' }, { status: 403 })
  }

  const { id } = await params
  const reqId = Number(id)
  if (!Number.isFinite(reqId)) {
    return NextResponse.json({ error: 'เลขรายการไม่ถูกต้อง' }, { status: 400 })
  }

  const row = await q1<{ slip_path: string | null }>(
    'select slip_path from credit_requests where id = $1',
    [reqId]
  )
  if (!row?.slip_path) {
    return NextResponse.json({ error: 'รายการนี้ไม่มีสลิปแนบไว้' }, { status: 404 })
  }

  const url = await signedSlipUrl(row.slip_path)
  if (!url) return NextResponse.json({ error: 'เปิดสลิปไม่สำเร็จ' }, { status: 500 })

  return NextResponse.redirect(url)
}
