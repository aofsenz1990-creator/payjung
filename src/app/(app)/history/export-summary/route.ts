import { NextResponse, type NextRequest } from 'next/server'
import { q } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { buildWhere, HISTORY_JOINS, parseFilters } from '@/lib/history'

export const dynamic = 'force-dynamic'

/** กันสูตร Excel แฝงมากับข้อความ (ชื่อเกมมาจากผู้ให้บริการ ไม่ได้พิมพ์เองทั้งหมด) */
function csvCell(value: unknown) {
  let s = value === null || value === undefined ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * รายงานสรุปยอดขายรายเกม สำหรับเอาไปทำบัญชี/ยื่นภาษี
 *
 * ต่างจากไฟล์ประวัติการเติม (export ปกติ) ตรงที่ไฟล์นั้นเป็นรายบิลทีละรายการ
 * ซึ่งเดือนหนึ่งอาจมีเป็นพันแถว เอาไปสรุปเองต่อยาก
 * ไฟล์นี้รวมให้เสร็จเป็นเกมละแถว พร้อมยอดขาย ต้นทุน และกำไร
 *
 * นับเฉพาะบิลที่จ่ายเงินแล้ว (paid) — บิลที่ยกเลิกหรือรอดำเนินการไม่ใช่รายได้
 */
export async function GET(request: NextRequest) {
  const user = await getSession()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  // รายงานนี้มีต้นทุนและกำไร จึงจำกัดเฉพาะผู้ดูแลระบบ
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'เฉพาะผู้ดูแลระบบเท่านั้น' }, { status: 403 })
  }

  const sp = Object.fromEntries(request.nextUrl.searchParams.entries())
  const filters = parseFilters(sp)
  const { where, params } = buildWhere(filters)
  const paidOnly = where ? `${where} and s.status = 'paid'` : `where s.status = 'paid'`

  const rows = await q<{
    game: string | null
    orders: number
    qty: number
    revenue: number
    cost: number
    profit: number
  }>(
    `select coalesce(g.name, 'ไม่ระบุเกม') as game,
            count(*)::int as orders,
            coalesce(sum(s.qty), 0)::int as qty,
            coalesce(sum(s.total), 0)::float8 as revenue,
            coalesce(sum(s.cost_total), 0)::float8 as cost,
            coalesce(sum(s.profit), 0)::float8 as profit
     ${HISTORY_JOINS} ${paidOnly}
      group by coalesce(g.name, 'ไม่ระบุเกม')
      order by sum(s.total) desc nulls last`,
    params
  )

  const header = [
    'เกม',
    'จำนวนบิล',
    'จำนวนชิ้น',
    'ยอดขาย (บาท)',
    'ต้นทุนขาย (บาท)',
    'กำไรขั้นต้น (บาท)',
    'อัตรากำไร (%)',
  ]

  const lines = [header.join(',')]
  let totalOrders = 0
  let totalQty = 0
  let totalRevenue = 0
  let totalCost = 0
  let totalProfit = 0

  for (const r of rows) {
    totalOrders += r.orders
    totalQty += r.qty
    totalRevenue += r.revenue
    totalCost += r.cost
    totalProfit += r.profit
    const margin = r.revenue > 0 ? (r.profit / r.revenue) * 100 : 0
    lines.push(
      [r.game, r.orders, r.qty, r.revenue.toFixed(2), r.cost.toFixed(2), r.profit.toFixed(2), margin.toFixed(2)]
        .map(csvCell)
        .join(',')
    )
  }

  // แถวรวมท้ายตาราง เอาไปกรอกแบบยื่นภาษีได้เลยโดยไม่ต้องบวกเอง
  const totalMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0
  lines.push('')
  lines.push(
    ['รวมทั้งหมด', totalOrders, totalQty, totalRevenue.toFixed(2), totalCost.toFixed(2), totalProfit.toFixed(2), totalMargin.toFixed(2)]
      .map(csvCell)
      .join(',')
  )

  const stamp = filters.month === 'all' ? 'ทั้งหมด' : filters.month
  lines.push('')
  lines.push(csvCell(`ช่วงเวลา: ${stamp} · นับเฉพาะบิลที่ชำระแล้ว · ออกรายงานโดย ${user.name}`))

  // ﻿ (BOM) ทำให้ Excel เปิดไฟล์แล้วอ่านภาษาไทยถูกต้อง
  return new NextResponse(`﻿${lines.join('\r\n')}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="payjung-summary-${stamp}.csv"`,
    },
  })
}
