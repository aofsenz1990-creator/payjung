import { NextResponse, type NextRequest } from 'next/server'
import { q } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { buildWhere, HISTORY_JOINS, parseFilters } from '@/lib/history'
import { SALE_STATUS, type SaleStatus } from '@/lib/constants'

export const dynamic = 'force-dynamic'

function csvCell(value: unknown) {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function GET(request: NextRequest) {
  const user = await getSession()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sp = Object.fromEntries(request.nextUrl.searchParams.entries())
  const filters = parseFilters(sp)
  const { where, params } = buildWhere(filters)

  const rows = await q<Record<string, unknown>>(
    `select s.code,
            to_char(s.sold_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD') as sale_date,
            to_char(s.sold_at at time zone 'Asia/Bangkok', 'HH24:MI')    as sale_time,
            g.name as game, s.item_name, s.game_account,
            coalesce(c.name, 'ลูกค้าทั่วไป') as customer,
            s.qty, s.unit_price::float8 as unit_price, s.total::float8 as total,
            s.unit_cost::float8 as unit_cost, s.cost_total::float8 as cost_total,
            s.profit::float8 as profit,
            s.payment_method, s.status, u.display_name as seller, s.note
     ${HISTORY_JOINS} ${where}
      order by s.sold_at desc, s.id desc
      limit 20000`,
    params
  )

  const isAdmin = user.role === 'admin'
  const header = [
    'เลขบิล',
    'วันที่',
    'เวลา',
    'เกม',
    'รายการ',
    'ไอดีเกม',
    'ลูกค้า',
    'จำนวน',
    'ราคาต่อหน่วย',
    'ยอดรวม',
    ...(isAdmin ? ['ต้นทุนต่อหน่วย', 'ต้นทุนรวม', 'กำไร'] : []),
    'ช่องทางชำระ',
    'สถานะ',
    'ผู้บันทึก',
    'หมายเหตุ',
  ]

  const lines = [header.join(',')]
  for (const r of rows) {
    const status = String(r.status)
    lines.push(
      [
        r.code,
        r.sale_date,
        r.sale_time,
        r.game ?? '',
        r.item_name,
        r.game_account ?? '',
        r.customer,
        r.qty,
        r.unit_price,
        r.total,
        ...(isAdmin ? [r.unit_cost, r.cost_total, r.profit] : []),
        r.payment_method,
        SALE_STATUS[(status in SALE_STATUS ? status : 'paid') as SaleStatus],
        r.seller ?? '',
        r.note ?? '',
      ]
        .map(csvCell)
        .join(',')
    )
  }

  const stamp = filters.month === 'all' ? 'all' : filters.month
  // ﻿ (BOM) ทำให้ Excel เปิดไฟล์แล้วอ่านภาษาไทยถูกต้อง
  return new NextResponse(`﻿${lines.join('\r\n')}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="payjung-sales-${stamp}.csv"`,
    },
  })
}
