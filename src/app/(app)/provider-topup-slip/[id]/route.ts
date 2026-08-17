import { NextResponse } from 'next/server'
import { q1 } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { signedSlipUrl } from '@/lib/storage'

export const dynamic = 'force-dynamic'

/** เปิดดูสลิปตอนร้านเติมเงินให้ผู้ให้บริการ — เฉพาะผู้ดูแลระบบ (เป็นข้อมูลต้นทุน) */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession()
  if (!user) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 })
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'ไม่มีสิทธิ์ดูสลิป' }, { status: 403 })
  }

  const { id } = await params
  const topupId = Number(id)
  if (!Number.isFinite(topupId)) {
    return NextResponse.json({ error: 'เลขรายการไม่ถูกต้อง' }, { status: 400 })
  }

  const row = await q1<{ slip_path: string | null }>(
    'select slip_path from provider_topups where id = $1',
    [topupId]
  )
  if (!row?.slip_path) {
    return NextResponse.json({ error: 'รายการนี้ไม่มีสลิปแนบไว้' }, { status: 404 })
  }

  const url = await signedSlipUrl(row.slip_path)
  if (!url) return NextResponse.json({ error: 'เปิดสลิปไม่สำเร็จ' }, { status: 500 })

  return NextResponse.redirect(url)
}
