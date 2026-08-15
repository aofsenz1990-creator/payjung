import { NextResponse } from 'next/server'
import { q1 } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { signedSlipUrl } from '@/lib/storage'

export const dynamic = 'force-dynamic'

/** เปิดดูสลิปการโอนคืนของรายการเคลม — ตรวจสิทธิ์ก่อนแล้วค่อยออกลิงก์ชั่วคราว */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession()
  if (!user) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 })
  if (!user.pages.includes('claims')) {
    return NextResponse.json({ error: 'ไม่มีสิทธิ์ดูสลิป' }, { status: 403 })
  }

  const { id } = await params
  const claimId = Number(id)
  if (!Number.isFinite(claimId)) {
    return NextResponse.json({ error: 'เลขรายการไม่ถูกต้อง' }, { status: 400 })
  }

  const claim = await q1<{ slip_path: string | null }>(
    'select slip_path from claims where id = $1',
    [claimId]
  )
  if (!claim?.slip_path) {
    return NextResponse.json({ error: 'รายการนี้ไม่มีสลิปแนบไว้' }, { status: 404 })
  }

  const url = await signedSlipUrl(claim.slip_path)
  if (!url) return NextResponse.json({ error: 'เปิดสลิปไม่สำเร็จ' }, { status: 500 })

  return NextResponse.redirect(url)
}
