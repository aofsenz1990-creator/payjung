import Link from 'next/link'
import { q } from '@/lib/db'
import { requirePage } from '@/lib/auth'
import {
  dateOnly,
  money,
  monthLabel,
  num,
  recentMonths,
  safeMonth,
  todayISO,
} from '@/lib/format'
import { AutoRefresh } from '@/components/AutoRefresh'
import { BarChart, RankBars } from '@/components/Charts'
import { MonthPicker } from '@/components/MonthPicker'
import { Empty, MoneyStat, PageHeader, SectionTitle } from '@/components/ui'

export const dynamic = 'force-dynamic'

type DayRow = {
  day: string
  orders: number
  qty: number
  revenue: number
  cost: number
  profit: number
}

/** รายชื่อวันทั้งเดือนแบบ YYYY-MM-DD ไม่ให้วันที่ไม่มียอดขายหายไปจากตาราง */
function daysInMonth(month: string) {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return Array.from(
    { length: last },
    (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`
  )
}

export default async function DailyPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; day?: string }>
}) {
  const user = await requirePage('daily')
  const showMoney = user.role === 'admin'
  const { month: monthParam, day: dayParam } = await searchParams
  const month = safeMonth(monthParam)
  const monthStart = `${month}-01`
  const today = todayISO()

  const allDays = daysInMonth(month)
  const selectedDay =
    dayParam && allDays.includes(dayParam)
      ? dayParam
      : allDays.includes(today)
        ? today
        : allDays[allDays.length - 1]

  const [sales, expenses, byGame, bySource, byPayment, dayBills] = await Promise.all([
    q<DayRow>(
      `select (sold_at at time zone 'Asia/Bangkok')::date::text as day,
              count(*)::int as orders,
              coalesce(sum(qty), 0)::int as qty,
              coalesce(sum(total), 0)::float8 as revenue,
              coalesce(sum(cost_total), 0)::float8 as cost,
              coalesce(sum(profit), 0)::float8 as profit
         from sales
        where status = 'paid'
          and (sold_at at time zone 'Asia/Bangkok')::date >= $1::date
          and (sold_at at time zone 'Asia/Bangkok')::date < $1::date + interval '1 month'
        group by 1 order by 1`,
      [monthStart]
    ),
    q<{ day: string; expense: number }>(
      `select spent_on::text as day, coalesce(sum(amount), 0)::float8 as expense
         from expenses
        where spent_on >= $1::date and spent_on < $1::date + interval '1 month'
        group by 1`,
      [monthStart]
    ),
    q<{ label: string; value: number; orders: number }>(
      `select coalesce(g.name, 'ไม่ระบุเกม') as label,
              sum(s.total)::float8 as value, count(*)::int as orders
         from sales s left join games g on g.id = s.game_id
        where s.status = 'paid' and (s.sold_at at time zone 'Asia/Bangkok')::date = $1::date
        group by 1 order by value desc limit 8`,
      [selectedDay]
    ),
    q<{ label: string; value: number; orders: number }>(
      `select coalesce(nullif(s.source, ''), 'ไม่ระบุช่องทาง') as label,
              sum(s.total)::float8 as value, count(*)::int as orders
         from sales s
        where s.status = 'paid' and (s.sold_at at time zone 'Asia/Bangkok')::date = $1::date
        group by 1 order by value desc`,
      [selectedDay]
    ),
    q<{ label: string; value: number; orders: number }>(
      `select s.payment_method as label, sum(s.total)::float8 as value, count(*)::int as orders
         from sales s
        where s.status = 'paid' and (s.sold_at at time zone 'Asia/Bangkok')::date = $1::date
        group by 1 order by value desc`,
      [selectedDay]
    ),
    q<{ orders: number; cancelled: number; pending: number }>(
      `select count(*) filter (where status = 'paid')::int as orders,
              count(*) filter (where status = 'cancelled')::int as cancelled,
              count(*) filter (where status = 'pending')::int as pending
         from sales
        where (sold_at at time zone 'Asia/Bangkok')::date = $1::date`,
      [selectedDay]
    ),
  ])

  const salesByDay = new Map(sales.map((r) => [r.day, r]))
  const expenseByDay = new Map(expenses.map((r) => [r.day, r.expense]))

  const rows = allDays.map((day) => {
    const s = salesByDay.get(day)
    const expense = expenseByDay.get(day) ?? 0
    const revenue = s?.revenue ?? 0
    const profit = s?.profit ?? 0
    return {
      day,
      orders: s?.orders ?? 0,
      qty: s?.qty ?? 0,
      revenue,
      cost: s?.cost ?? 0,
      profit,
      expense,
      net: profit - expense,
      isFuture: day > today,
    }
  })

  const totals = rows.reduce(
    (a, r) => ({
      orders: a.orders + r.orders,
      qty: a.qty + r.qty,
      revenue: a.revenue + r.revenue,
      cost: a.cost + r.cost,
      profit: a.profit + r.profit,
      expense: a.expense + r.expense,
    }),
    { orders: 0, qty: 0, revenue: 0, cost: 0, profit: 0, expense: 0 }
  )
  const net = totals.profit - totals.expense

  const activeDays = rows.filter((r) => r.orders > 0)
  const best = activeDays.reduce<(typeof rows)[number] | null>(
    (a, r) => (!a || r.revenue > a.revenue ? r : a),
    null
  )
  const average = activeDays.length > 0 ? totals.revenue / activeDays.length : 0
  const daySummary = dayBills[0] ?? { orders: 0, cancelled: 0, pending: 0 }
  const selected = rows.find((r) => r.day === selectedDay)

  return (
    <>
      <PageHeader
        title="สรุปยอดขายรายวัน"
        subtitle={`แยกยอดทีละวันตลอด ${monthLabel(month)}`}
      >
        <AutoRefresh seconds={60} />
        <MonthPicker value={month} months={recentMonths(todayISO().slice(0, 7), 24)} />
      </PageHeader>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MoneyStat
          label={`ยอดขายรวม ${monthLabel(month)}`}
          amount={totals.revenue}
          hint={`${num(totals.orders)} บิล · ขายจริง ${num(activeDays.length)} วัน`}
        />
        <MoneyStat label="เฉลี่ยต่อวันที่มีการขาย" amount={average} />
        {showMoney ? (
          <MoneyStat label="กำไรขั้นต้นรวม" amount={totals.profit} tone="good" />
        ) : (
          <div className="card">
            <p className="text-xs font-medium text-mute">จำนวนที่เติมรวม</p>
            <p className="mt-2 text-2xl font-bold text-white">
              {num(totals.qty)}
              <span className="ml-1 text-sm font-medium text-mute">ชิ้น/ครั้ง</span>
            </p>
          </div>
        )}
        {showMoney ? (
          <MoneyStat
            label="กำไรสุทธิ (หักค่าใช้จ่าย)"
            amount={net}
            tone={net >= 0 ? 'good' : 'bad'}
            hint={`ค่าใช้จ่ายเดือนนี้ ${money(totals.expense)}`}
          />
        ) : (
          <div className="card">
            <p className="text-xs font-medium text-mute">วันที่ขายดีที่สุด</p>
            <p className="mt-2 text-2xl font-bold text-white">
              {best ? dateOnly(`${best.day}T00:00:00+07:00`) : '-'}
            </p>
            {best ? <p className="mt-1 text-xs text-mute">{money(best.revenue)} บาท</p> : null}
          </div>
        )}
      </div>

      <div className="card mb-6">
        <SectionTitle right={<span className="text-xs text-mute">หน่วย: บาท</span>}>
          กราฟยอดขายรายวัน
        </SectionTitle>
        <BarChart
          data={rows.map((r) => ({ label: r.day.slice(-2), value: r.revenue }))}
          height={200}
        />
      </div>

      <div className="card mb-6">
        <SectionTitle
          right={
            <span className="text-xs text-mute">
              กดที่วันที่เพื่อดูรายละเอียดของวันนั้น
            </span>
          }
        >
          ตารางรายวัน
        </SectionTitle>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>วันที่</th>
                <th className="text-right">บิล</th>
                <th className="text-right">จำนวน</th>
                <th className="text-right">ยอดขาย</th>
                {showMoney ? <th className="text-right">ทุน</th> : null}
                {showMoney ? <th className="text-right">กำไรขั้นต้น</th> : null}
                {showMoney ? <th className="text-right">ค่าใช้จ่าย</th> : null}
                {showMoney ? <th className="text-right">กำไรสุทธิ</th> : null}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.day}
                  className={
                    r.day === selectedDay
                      ? 'bg-brand-500/10'
                      : r.isFuture
                        ? 'opacity-40'
                        : undefined
                  }
                >
                  <td className="whitespace-nowrap">
                    <Link
                      href={`/daily?month=${month}&day=${r.day}`}
                      className={
                        r.day === selectedDay
                          ? 'font-medium text-brand-400'
                          : 'text-slate-200 hover:text-brand-400'
                      }
                    >
                      {dateOnly(`${r.day}T00:00:00+07:00`)}
                    </Link>
                    {r.day === today ? (
                      <span className="ml-2 text-xs text-good">วันนี้</span>
                    ) : null}
                  </td>
                  <td className="text-right">{r.orders > 0 ? num(r.orders) : '-'}</td>
                  <td className="text-right">{r.qty > 0 ? num(r.qty) : '-'}</td>
                  <td className="text-right font-medium text-white">
                    {r.revenue > 0 ? money(r.revenue) : '-'}
                  </td>
                  {showMoney ? (
                    <td className="text-right text-mute">{r.cost > 0 ? money(r.cost) : '-'}</td>
                  ) : null}
                  {showMoney ? (
                    <td className="text-right text-good">
                      {r.profit !== 0 ? money(r.profit) : '-'}
                    </td>
                  ) : null}
                  {showMoney ? (
                    <td className="text-right text-warn">
                      {r.expense > 0 ? money(r.expense) : '-'}
                    </td>
                  ) : null}
                  {showMoney ? (
                    <td
                      className={`text-right font-medium ${r.net >= 0 ? 'text-good' : 'text-bad'}`}
                    >
                      {r.orders > 0 || r.expense > 0 ? money(r.net) : '-'}
                    </td>
                  ) : null}
                  <td className="text-right">
                    {r.orders > 0 ? (
                      <Link
                        href={`/history?month=${month}&from=${r.day}&to=${r.day}`}
                        className="text-xs text-brand-400 underline"
                      >
                        ดูบิล
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="font-medium text-mute">รวมทั้งเดือน</td>
                <td className="text-right font-medium">{num(totals.orders)}</td>
                <td className="text-right font-medium">{num(totals.qty)}</td>
                <td className="text-right text-lg font-bold text-white">
                  {money(totals.revenue)}
                </td>
                {showMoney ? (
                  <td className="text-right text-mute">{money(totals.cost)}</td>
                ) : null}
                {showMoney ? (
                  <td className="text-right font-medium text-good">{money(totals.profit)}</td>
                ) : null}
                {showMoney ? (
                  <td className="text-right font-medium text-warn">{money(totals.expense)}</td>
                ) : null}
                {showMoney ? (
                  <td className={`text-right font-bold ${net >= 0 ? 'text-good' : 'text-bad'}`}>
                    {money(net)}
                  </td>
                ) : null}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* รายละเอียดของวันที่เลือก */}
      <div>
        <h2 className="mb-4 text-base font-semibold text-white">
          รายละเอียดวันที่ {dateOnly(`${selectedDay}T00:00:00+07:00`)}
          <span className="ml-3 text-sm font-normal text-mute">
            {num(daySummary.orders)} บิลสำเร็จ
            {daySummary.pending > 0 ? ` · รอดำเนินการ ${num(daySummary.pending)}` : ''}
            {daySummary.cancelled > 0 ? ` · ยกเลิก ${num(daySummary.cancelled)}` : ''}
          </span>
        </h2>

        {selected && selected.orders === 0 ? (
          <div className="card">
            <Empty>วันนี้ยังไม่มียอดขาย</Empty>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="card">
              <SectionTitle>ขายดีตามเกม</SectionTitle>
              <RankBars
                data={byGame.map((g) => ({
                  label: g.label,
                  value: g.value,
                  sub: `${num(g.orders)} บิล`,
                }))}
              />
            </div>
            <div className="card">
              <SectionTitle>ลูกค้ามาจากช่องทางไหน</SectionTitle>
              <RankBars
                data={bySource.map((s) => ({
                  label: s.label,
                  value: s.value,
                  sub: `${num(s.orders)} บิล`,
                }))}
              />
            </div>
            <div className="card">
              <SectionTitle>ช่องทางรับเงิน</SectionTitle>
              <RankBars
                data={byPayment.map((p) => ({
                  label: p.label,
                  value: p.value,
                  sub: `${num(p.orders)} บิล`,
                }))}
              />
            </div>
          </div>
        )}
      </div>
    </>
  )
}
