import Link from 'next/link'
import { q, q1 } from '@/lib/db'
import { requirePage } from '@/lib/auth'
import { cancelSaleAction, deleteSaleAction, markPaidAction } from '@/lib/actions/sales'
import { buildWhere, filtersToQuery, HISTORY_JOINS, parseFilters } from '@/lib/history'
import { dateOnly, money, monthLabel, num, recentMonths, timeOnly, todayISO } from '@/lib/format'
import { ConfirmButton } from '@/components/ActionForm'
import { Empty, MoneyStat, PageHeader, SectionTitle, StatusBadge } from '@/components/ui'
import { SALE_STATUS } from '@/lib/constants'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await requirePage('history')
  const showMoney = user.role === 'admin'
  const sp = await searchParams
  const filters = parseFilters(sp)
  const page = Math.max(Number.parseInt(String(sp.page ?? '1'), 10) || 1, 1)
  const { where, params } = buildWhere(filters)

  const [rows, summary, games, customers, byDay] = await Promise.all([
    q<{
      id: number
      code: string
      sold_at: string
      item_name: string
      game: string | null
      customer: string | null
      game_account: string | null
      qty: number
      unit_price: number
      total: number
      profit: number
      status: string
      payment_method: string
      seller: string | null
      note: string | null
    }>(
      `select s.id, s.code, s.sold_at, s.item_name, g.name as game, c.name as customer,
              s.game_account, s.qty, s.unit_price::float8 as unit_price, s.total::float8 as total,
              s.profit::float8 as profit, s.status, s.payment_method,
              u.display_name as seller, s.note
       ${HISTORY_JOINS} ${where}
        order by s.sold_at desc, s.id desc
        limit ${PAGE_SIZE + 1} offset ${(page - 1) * PAGE_SIZE}`,
      params
    ),
    q1<{ orders: number; total: number; profit: number; qty: number }>(
      `select count(*)::int as orders,
              coalesce(sum(s.total) filter (where s.status = 'paid'), 0)::float8 as total,
              coalesce(sum(s.profit) filter (where s.status = 'paid'), 0)::float8 as profit,
              coalesce(sum(s.qty) filter (where s.status = 'paid'), 0)::int as qty
       ${HISTORY_JOINS} ${where}`,
      params
    ),
    q<{ id: number; name: string }>('select id, name from games order by name'),
    q<{ id: number; name: string }>('select id, name from customers order by name'),
    q<{ day: string; total: number; orders: number }>(
      `select to_char((s.sold_at at time zone 'Asia/Bangkok')::date, 'YYYY-MM-DD') as day,
              coalesce(sum(s.total) filter (where s.status = 'paid'), 0)::float8 as total,
              count(*)::int as orders
       ${HISTORY_JOINS} ${where}
        group by 1 order by 1 desc limit 10`,
      params
    ),
  ])

  const hasNext = rows.length > PAGE_SIZE
  const list = rows.slice(0, PAGE_SIZE)
  const s = summary ?? { orders: 0, total: 0, profit: 0, qty: 0 }
  const months = ['all', ...recentMonths(todayISO().slice(0, 7), 24)]

  const pageHref = (p: number) => `/history?${filtersToQuery(filters, { page: String(p) })}`

  return (
    <>
      <PageHeader
        title="ประวัติการเติม"
        subtitle="ค้นหาย้อนหลังตามวัน เดือน เกม ลูกค้า หรือเลขบิล"
      >
        <a className="btn-ghost" href={`/history/export?${filtersToQuery(filters)}`}>
          ⬇ ดาวน์โหลด CSV
        </a>
      </PageHeader>

      {/* ตัวกรอง */}
      <form className="card mb-6 grid gap-3 md:grid-cols-3 lg:grid-cols-6" method="get">
        <div>
          <label className="label" htmlFor="month">
            เดือน
          </label>
          <select id="month" name="month" className="input" defaultValue={filters.month}>
            {months.map((m) => (
              <option key={m} value={m}>
                {m === 'all' ? 'ทุกเดือน' : monthLabel(m)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="from">
            ตั้งแต่วันที่
          </label>
          <input
            id="from"
            name="from"
            type="date"
            className="input"
            defaultValue={filters.from ?? ''}
          />
        </div>
        <div>
          <label className="label" htmlFor="to">
            ถึงวันที่
          </label>
          <input id="to" name="to" type="date" className="input" defaultValue={filters.to ?? ''} />
        </div>
        <div>
          <label className="label" htmlFor="game">
            เกม
          </label>
          <select id="game" name="game" className="input" defaultValue={filters.gameId ?? ''}>
            <option value="">ทุกเกม</option>
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="customer">
            ลูกค้า
          </label>
          <select
            id="customer"
            name="customer"
            className="input"
            defaultValue={filters.customerId ?? ''}
          >
            <option value="">ทุกคน</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="status">
            สถานะ
          </label>
          <select id="status" name="status" className="input" defaultValue={filters.status}>
            <option value="all">ทุกสถานะ</option>
            {Object.entries(SALE_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2 lg:col-span-4">
          <label className="label" htmlFor="q">
            ค้นหา (เลขบิล / รายการ / ไอดีเกม / ชื่อลูกค้า / หมายเหตุ)
          </label>
          <input id="q" name="q" className="input" defaultValue={filters.keyword} />
        </div>
        <div className="flex items-end gap-2 md:col-span-1 lg:col-span-2">
          <button type="submit" className="btn-primary flex-1">
            ค้นหา
          </button>
          <Link href="/history" className="btn-ghost">
            ล้าง
          </Link>
        </div>
      </form>

      {/* สรุปตามเงื่อนไขที่กรอง */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="card">
          <p className="text-xs font-medium text-mute">จำนวนบิลที่พบ</p>
          <p className="mt-2 text-2xl font-bold text-white">
            {num(s.orders)}
            <span className="ml-1 text-sm font-medium text-mute">บิล</span>
          </p>
        </div>
        <MoneyStat label="ยอดขายรวม (เฉพาะบิลสำเร็จ)" amount={s.total} />
        {showMoney ? <MoneyStat label="กำไรรวม" amount={s.profit} tone="good" /> : null}
        <div className="card">
          <p className="text-xs font-medium text-mute">จำนวนที่เติมรวม</p>
          <p className="mt-2 text-2xl font-bold text-white">
            {num(s.qty)}
            <span className="ml-1 text-sm font-medium text-mute">ชิ้น/ครั้ง</span>
          </p>
        </div>
      </div>

      {byDay.length > 1 ? (
        <div className="card mb-6">
          <SectionTitle>สรุปรายวัน (10 วันล่าสุดในผลค้นหา)</SectionTitle>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>วันที่</th>
                  <th className="text-right">จำนวนบิล</th>
                  <th className="text-right">ยอดขาย</th>
                </tr>
              </thead>
              <tbody>
                {byDay.map((d) => (
                  <tr key={d.day}>
                    <td>{dateOnly(`${d.day}T00:00:00+07:00`)}</td>
                    <td className="text-right">{num(d.orders)}</td>
                    <td className="text-right font-medium text-white">{money(d.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* ตารางบิล */}
      <div className="card">
        <SectionTitle
          right={
            <span className="text-xs text-mute">
              หน้า {num(page)} · แสดง {num(list.length)} รายการ
            </span>
          }
        >
          รายการทั้งหมด
        </SectionTitle>

        {list.length === 0 ? (
          <Empty>ไม่พบรายการตามเงื่อนไขที่เลือก</Empty>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>เลขบิล</th>
                  <th>วันที่</th>
                  <th>เวลา</th>
                  <th>เกม / รายการ</th>
                  <th>ลูกค้า / ไอดี</th>
                  <th className="text-right">จำนวน</th>
                  <th className="text-right">ราคา/หน่วย</th>
                  <th className="text-right">ยอดรวม</th>
                  {showMoney ? <th className="text-right">กำไร</th> : null}
                  <th>ช่องทาง</th>
                  <th>ผู้บันทึก</th>
                  <th>สถานะ</th>
                  <th className="text-right">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id}>
                    <td className="font-mono text-xs text-mute">{r.code}</td>
                    <td className="whitespace-nowrap text-xs">{dateOnly(r.sold_at)}</td>
                    <td className="whitespace-nowrap text-xs text-mute">{timeOnly(r.sold_at)} น.</td>
                    <td>
                      <span className="block text-slate-100">{r.item_name}</span>
                      <span className="block text-xs text-mute">{r.game ?? '-'}</span>
                      {r.note ? <span className="block text-xs text-mute">📝 {r.note}</span> : null}
                    </td>
                    <td>
                      <span className="block text-slate-300">{r.customer ?? 'ลูกค้าทั่วไป'}</span>
                      {r.game_account ? (
                        <span className="block text-xs text-mute">{r.game_account}</span>
                      ) : null}
                    </td>
                    <td className="text-right">{num(r.qty)}</td>
                    <td className="text-right text-mute">{money(r.unit_price)}</td>
                    <td className="text-right font-medium text-white">{money(r.total)}</td>
                    {showMoney ? (
                      <td className={`text-right ${r.profit >= 0 ? 'text-good' : 'text-bad'}`}>
                        {money(r.profit)}
                      </td>
                    ) : null}
                    <td className="whitespace-nowrap text-xs text-mute">{r.payment_method}</td>
                    <td className="whitespace-nowrap text-xs text-mute">{r.seller ?? '-'}</td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    <td>
                      <div className="flex justify-end gap-1.5">
                        {r.status === 'pending' ? (
                          <form action={markPaidAction}>
                            <input type="hidden" name="id" value={r.id} />
                            <button type="submit" className="btn-ghost btn-sm">
                              รับเงินแล้ว
                            </button>
                          </form>
                        ) : null}
                        {r.status !== 'cancelled' ? (
                          <form action={cancelSaleAction}>
                            <input type="hidden" name="id" value={r.id} />
                            <ConfirmButton message={`ยกเลิกบิล ${r.code} และคืนสต๊อก?`}>
                              ยกเลิก
                            </ConfirmButton>
                          </form>
                        ) : null}
                        {showMoney ? (
                          <form action={deleteSaleAction}>
                            <input type="hidden" name="id" value={r.id} />
                            <ConfirmButton
                              message={`ลบบิล ${r.code} ถาวร? การลบจะกู้คืนไม่ได้`}
                              className="btn-danger btn-sm"
                            >
                              ลบ
                            </ConfirmButton>
                          </form>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-3">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="btn-ghost btn-sm">
              ← ก่อนหน้า
            </Link>
          ) : (
            <span />
          )}
          {hasNext ? (
            <Link href={pageHref(page + 1)} className="btn-ghost btn-sm">
              ถัดไป →
            </Link>
          ) : (
            <span />
          )}
        </div>
      </div>
    </>
  )
}
