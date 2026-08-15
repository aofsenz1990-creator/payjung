import Link from 'next/link'
import { q, q1 } from '@/lib/db'
import { requirePage } from '@/lib/auth'
import { dateTime, money, monthLabel, num, recentMonths, safeMonth, todayISO } from '@/lib/format'
import { BarChart, RankBars } from '@/components/Charts'
import { MenuPermissions, loadStaff } from '@/components/MenuPermissions'
import { MonthPicker } from '@/components/MonthPicker'
import {
  Badge,
  CountStat,
  Empty,
  MoneyStat,
  PageHeader,
  SectionTitle,
  StatusBadge,
} from '@/components/ui'

export const dynamic = 'force-dynamic'

type Totals = {
  today_revenue: number
  today_profit: number
  today_orders: number
  month_revenue: number
  month_profit: number
  month_orders: number
  prev_month_revenue: number
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const user = await requirePage('dashboard')
  const showMoney = user.role === 'admin'
  const { month: monthParam } = await searchParams
  const month = safeMonth(monthParam)
  const monthStart = `${month}-01`
  const today = todayISO()

  const [totals, series, topGames, topCustomers, expense, lowStock, recent, catalog] =
    await Promise.all([
      q1<Totals>(
        `select
           coalesce(sum(total) filter (where d = $1::date), 0)::float8            as today_revenue,
           coalesce(sum(profit) filter (where d = $1::date), 0)::float8           as today_profit,
           (count(*) filter (where d = $1::date))::int                            as today_orders,
           coalesce(sum(total) filter (where d >= $2::date
             and d < ($2::date + interval '1 month')), 0)::float8                 as month_revenue,
           coalesce(sum(profit) filter (where d >= $2::date
             and d < ($2::date + interval '1 month')), 0)::float8                 as month_profit,
           (count(*) filter (where d >= $2::date
             and d < ($2::date + interval '1 month')))::int                       as month_orders,
           coalesce(sum(total) filter (where d >= ($2::date - interval '1 month')
             and d < $2::date), 0)::float8                                        as prev_month_revenue
         from (
           select total, profit, (sold_at at time zone 'Asia/Bangkok')::date as d
             from sales where status = 'paid'
         ) s`,
        [today, monthStart]
      ),

      q<{ label: string; value: number }>(
        `select to_char(g.day, 'DD') as label, coalesce(sum(s.total), 0)::float8 as value
           from generate_series($1::date, ($1::date + interval '1 month' - interval '1 day'),
                                interval '1 day') as g(day)
           left join (
             select total, (sold_at at time zone 'Asia/Bangkok')::date as d
               from sales where status = 'paid'
           ) s on s.d = g.day::date
          group by g.day
          order by g.day`,
        [monthStart]
      ),

      q<{ label: string; value: number; orders: number }>(
        `select coalesce(g.name, 'ไม่ระบุเกม') as label,
                sum(s.total)::float8 as value,
                count(*)::int as orders
           from sales s left join games g on g.id = s.game_id
          where s.status = 'paid'
            and (s.sold_at at time zone 'Asia/Bangkok')::date >= $1::date
            and (s.sold_at at time zone 'Asia/Bangkok')::date < $1::date + interval '1 month'
          group by 1 order by value desc limit 6`,
        [monthStart]
      ),

      q<{ label: string; value: number; orders: number }>(
        `select c.name as label, sum(s.total)::float8 as value, count(*)::int as orders
           from sales s join customers c on c.id = s.customer_id
          where s.status = 'paid'
            and (s.sold_at at time zone 'Asia/Bangkok')::date >= $1::date
            and (s.sold_at at time zone 'Asia/Bangkok')::date < $1::date + interval '1 month'
          group by c.id, c.name order by value desc limit 6`,
        [monthStart]
      ),

      q1<{ total: number }>(
        `select coalesce(sum(amount), 0)::float8 as total from expenses
          where spent_on >= $1::date and spent_on < $1::date + interval '1 month'`,
        [monthStart]
      ),

      q<{ id: number; name: string; game: string; stock_qty: number; low_stock: number }>(
        `select p.id, p.name, g.name as game, p.stock_qty, p.low_stock
           from products p join games g on g.id = p.game_id
          where p.track_stock and p.is_active and p.stock_qty <= p.low_stock
          order by p.stock_qty asc, g.name limit 8`
      ),

      q<{
        id: number
        code: string
        sold_at: string
        item_name: string
        game: string | null
        customer: string | null
        qty: number
        total: number
        profit: number
        status: string
      }>(
        `select s.id, s.code, s.sold_at, s.item_name, g.name as game, c.name as customer,
                s.qty, s.total::float8 as total, s.profit::float8 as profit, s.status
           from sales s
           left join games g on g.id = s.game_id
           left join customers c on c.id = s.customer_id
          order by s.sold_at desc limit 8`
      ),

      q1<{ games: number; products: number; customers: number }>(
        `select (select count(*) from games where is_active)::int as games,
                (select count(*) from products where is_active)::int as products,
                (select count(*) from customers)::int as customers`
      ),
    ])

  // การ์ดกำหนดสิทธิ์เมนูแสดงเฉพาะผู้ดูแลระบบ พนักงานไม่ต้องเสียเวลาโหลด
  const staff = showMoney ? await loadStaff() : []

  const t = totals ?? {
    today_revenue: 0,
    today_profit: 0,
    today_orders: 0,
    month_revenue: 0,
    month_profit: 0,
    month_orders: 0,
    prev_month_revenue: 0,
  }
  const expenseTotal = expense?.total ?? 0
  const netProfit = t.month_profit - expenseTotal
  const diff = t.month_revenue - t.prev_month_revenue
  const diffPct =
    t.prev_month_revenue > 0 ? Math.round((diff / t.prev_month_revenue) * 100) : null

  return (
    <>
      <PageHeader title="แดชบอร์ดสรุปยอด" subtitle={`ภาพรวมของ ${monthLabel(month)}`}>
        <MonthPicker value={month} months={recentMonths(todayISO().slice(0, 7))} />
        <Link href="/sales" className="btn-primary">
          + ลงยอดขาย
        </Link>
      </PageHeader>

      {/* วันนี้ */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MoneyStat label="ยอดขายวันนี้" amount={t.today_revenue} hint={`${num(t.today_orders)} บิล`} />
        {showMoney ? (
          <MoneyStat label="กำไรวันนี้" amount={t.today_profit} tone="good" />
        ) : (
          <CountStat label="จำนวนบิลวันนี้" count={t.today_orders} unit="บิล" />
        )}
        <MoneyStat
          label={`ยอดขาย ${monthLabel(month)}`}
          amount={t.month_revenue}
          hint={
            diffPct === null
              ? `${num(t.month_orders)} บิล`
              : `${num(t.month_orders)} บิล · ${diff >= 0 ? '▲' : '▼'} ${Math.abs(diffPct)}% จากเดือนก่อน`
          }
        />
        {showMoney ? (
          <MoneyStat
            label="กำไรสุทธิเดือนนี้"
            amount={netProfit}
            tone={netProfit >= 0 ? 'good' : 'bad'}
            hint={`กำไรขั้นต้น ${money(t.month_profit)} − ค่าใช้จ่าย ${money(expenseTotal)}`}
          />
        ) : (
          <CountStat label="บิลทั้งเดือน" count={t.month_orders} unit="บิล" />
        )}
      </div>

      {/* กราฟ + อันดับ */}
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <SectionTitle right={<span className="text-xs text-mute">หน่วย: บาท</span>}>
            ยอดขายรายวัน — {monthLabel(month)}
          </SectionTitle>
          <BarChart data={series} />
        </div>
        <div className="card">
          <SectionTitle>เกมขายดีประจำเดือน</SectionTitle>
          <RankBars
            data={topGames.map((g) => ({
              label: g.label,
              value: g.value,
              sub: `${num(g.orders)} บิล`,
            }))}
          />
        </div>
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <div className="card">
          <SectionTitle right={<Link href="/customers" className="text-xs text-brand-400">ดูทั้งหมด</Link>}>
            ลูกค้าที่ซื้อสูงสุด
          </SectionTitle>
          <RankBars
            data={topCustomers.map((c) => ({
              label: c.label,
              value: c.value,
              sub: `${num(c.orders)} บิล`,
            }))}
          />
        </div>

        <div className="card">
          <SectionTitle right={<Link href="/stock" className="text-xs text-brand-400">จัดการสต๊อก</Link>}>
            สต๊อกใกล้หมด
          </SectionTitle>
          {lowStock.length === 0 ? (
            <Empty>สต๊อกทุกรายการยังอยู่ในระดับปกติ 👍</Empty>
          ) : (
            <ul className="space-y-2.5">
              {lowStock.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate text-slate-200">{p.name}</span>
                    <span className="block truncate text-xs text-mute">{p.game}</span>
                  </span>
                  <Badge tone={p.stock_qty === 0 ? 'bad' : 'warn'}>
                    เหลือ {num(p.stock_qty)}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <SectionTitle>ข้อมูลในระบบ</SectionTitle>
          <dl className="space-y-3 text-sm">
            <Row label="เกมที่เปิดขาย" value={`${num(catalog?.games ?? 0)} เกม`} href="/games" />
            <Row label="แพ็กเกจเติม" value={`${num(catalog?.products ?? 0)} รายการ`} href="/games" />
            <Row label="ลูกค้าในระบบ" value={`${num(catalog?.customers ?? 0)} คน`} href="/customers" />
            {showMoney ? (
              <Row
                label="ค่าใช้จ่ายเดือนนี้"
                value={`${money(expenseTotal)} บาท`}
                href="/expenses"
              />
            ) : null}
          </dl>
        </div>
      </div>

      {/* บิลล่าสุด */}
      <div className="card">
        <SectionTitle right={<Link href="/history" className="text-xs text-brand-400">ดูประวัติทั้งหมด</Link>}>
          รายการเติมล่าสุด
        </SectionTitle>
        {recent.length === 0 ? (
          <Empty>
            ยังไม่มีรายการขาย — เริ่มที่{' '}
            <Link href="/sales" className="text-brand-400 underline">
              ลงยอดขาย
            </Link>
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>เลขบิล</th>
                  <th>เวลา</th>
                  <th>เกม / รายการ</th>
                  <th>ลูกค้า</th>
                  <th className="text-right">จำนวน</th>
                  <th className="text-right">ยอด</th>
                  {showMoney ? <th className="text-right">กำไร</th> : null}
                  <th>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((s) => (
                  <tr key={s.id}>
                    <td className="font-mono text-xs text-mute">{s.code}</td>
                    <td className="whitespace-nowrap text-xs text-mute">{dateTime(s.sold_at)}</td>
                    <td>
                      <span className="block text-slate-100">{s.item_name}</span>
                      <span className="block text-xs text-mute">{s.game ?? '-'}</span>
                    </td>
                    <td className="text-slate-300">{s.customer ?? 'ลูกค้าทั่วไป'}</td>
                    <td className="text-right">{num(s.qty)}</td>
                    <td className="text-right font-medium text-white">{money(s.total)}</td>
                    {showMoney ? (
                      <td className={`text-right ${s.profit >= 0 ? 'text-good' : 'text-bad'}`}>
                        {money(s.profit)}
                      </td>
                    ) : null}
                    <td>
                      <StatusBadge status={s.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* กำหนดสิทธิ์เมนูของพนักงาน — เฉพาะผู้ดูแลระบบ */}
      {showMoney ? (
        <div className="mt-6">
          <MenuPermissions staff={staff} compact />
        </div>
      ) : null}
    </>
  )
}

function Row({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-mute">{label}</dt>
      <dd>
        <Link href={href} className="font-medium text-white hover:text-brand-400">
          {value}
        </Link>
      </dd>
    </div>
  )
}
