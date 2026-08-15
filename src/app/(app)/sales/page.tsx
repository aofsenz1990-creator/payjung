import Link from 'next/link'
import { q } from '@/lib/db'
import { requirePage } from '@/lib/auth'
import { createSaleAction, cancelSaleAction, markPaidAction } from '@/lib/actions/sales'
import { dateTime, money, nowLocalInput, num, todayISO } from '@/lib/format'
import { ConfirmButton } from '@/components/ActionForm'
import { SaleForm, type CustomerOption, type GameOption, type ProductOption } from '@/components/SaleForm'
import { Empty, MoneyStat, PageHeader, SectionTitle, StatusBadge } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function SalesPage() {
  const user = await requirePage('sales')
  const showMoney = user.role === 'admin'

  const [games, products, customers, todaySales, todayTotal] = await Promise.all([
    q<GameOption>('select id, name from games where is_active order by name'),
    q<ProductOption>(
      `select id, game_id, name, sell_price::float8 as sell_price, cost_price::float8 as cost_price,
              track_stock, stock_qty
         from products where is_active order by name`
    ),
    q<CustomerOption>('select id, name, game_uid from customers order by name'),
    q<{
      id: number
      code: string
      sold_at: string
      item_name: string
      game: string | null
      customer: string | null
      game_account: string | null
      qty: number
      total: number
      profit: number
      status: string
      payment_method: string
      seller: string | null
    }>(
      `select s.id, s.code, s.sold_at, s.item_name, g.name as game, c.name as customer,
              s.game_account, s.qty, s.total::float8 as total, s.profit::float8 as profit,
              s.status, s.payment_method, u.display_name as seller
         from sales s
         left join games g on g.id = s.game_id
         left join customers c on c.id = s.customer_id
         left join profiles u on u.id = s.created_by
        where (s.sold_at at time zone 'Asia/Bangkok')::date = $1::date
        order by s.sold_at desc`,
      [todayISO()]
    ),
    q<{ total: number; profit: number; orders: number }>(
      `select coalesce(sum(total),0)::float8 as total, coalesce(sum(profit),0)::float8 as profit,
              count(*)::int as orders
         from sales
        where status = 'paid' and (sold_at at time zone 'Asia/Bangkok')::date = $1::date`,
      [todayISO()]
    ),
  ])

  const summary = todayTotal[0] ?? { total: 0, profit: 0, orders: 0 }

  return (
    <>
      <PageHeader title="ลงยอดขาย" subtitle="บันทึกรายการเติมเกมแต่ละบิล ระบบจะตัดสต๊อกให้อัตโนมัติ">
        <Link href="/history" className="btn-ghost">
          ประวัติทั้งหมด
        </Link>
      </PageHeader>

      {games.length === 0 ? (
        <div className="card mb-6">
          <Empty>
            ยังไม่มีเกมในระบบ —{' '}
            <Link href="/games" className="text-brand-400 underline">
              เพิ่มรายชื่อเกมก่อน
            </Link>
          </Empty>
        </div>
      ) : null}

      <div className="card mb-6">
        <SectionTitle>บิลใหม่</SectionTitle>
        <SaleForm
          action={createSaleAction}
          games={games}
          products={products}
          customers={customers}
          isAdmin={showMoney}
          defaultSoldAt={nowLocalInput()}
        />
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <MoneyStat label="ยอดขายวันนี้" amount={summary.total} hint={`${num(summary.orders)} บิล`} />
        {showMoney ? <MoneyStat label="กำไรวันนี้" amount={summary.profit} tone="good" /> : null}
        <div className="card">
          <p className="text-xs font-medium text-mute">บิลที่ลงวันนี้</p>
          <p className="mt-2 text-2xl font-bold text-white">
            {num(todaySales.length)}
            <span className="ml-1 text-sm font-medium text-mute">รายการ</span>
          </p>
          <p className="mt-1 text-xs text-mute">รวมบิลที่ยกเลิกและรอดำเนินการ</p>
        </div>
      </div>

      <div className="card">
        <SectionTitle>บิลของวันนี้</SectionTitle>
        {todaySales.length === 0 ? (
          <Empty>ยังไม่มีบิลของวันนี้</Empty>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>เลขบิล</th>
                  <th>เวลา</th>
                  <th>รายการ</th>
                  <th>ลูกค้า / ไอดี</th>
                  <th className="text-right">จำนวน</th>
                  <th className="text-right">ยอด</th>
                  {showMoney ? <th className="text-right">กำไร</th> : null}
                  <th>ช่องทาง</th>
                  <th>สถานะ</th>
                  <th className="text-right">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {todaySales.map((s) => (
                  <tr key={s.id}>
                    <td className="font-mono text-xs text-mute">{s.code}</td>
                    <td className="whitespace-nowrap text-xs text-mute">{dateTime(s.sold_at)}</td>
                    <td>
                      <span className="block text-slate-100">{s.item_name}</span>
                      <span className="block text-xs text-mute">
                        {s.game ?? '-'}
                        {s.seller ? ` · โดย ${s.seller}` : ''}
                      </span>
                    </td>
                    <td>
                      <span className="block text-slate-300">{s.customer ?? 'ลูกค้าทั่วไป'}</span>
                      {s.game_account ? (
                        <span className="block text-xs text-mute">{s.game_account}</span>
                      ) : null}
                    </td>
                    <td className="text-right">{num(s.qty)}</td>
                    <td className="text-right font-medium text-white">{money(s.total)}</td>
                    {showMoney ? (
                      <td className={`text-right ${s.profit >= 0 ? 'text-good' : 'text-bad'}`}>
                        {money(s.profit)}
                      </td>
                    ) : null}
                    <td className="whitespace-nowrap text-xs text-mute">{s.payment_method}</td>
                    <td>
                      <StatusBadge status={s.status} />
                    </td>
                    <td>
                      <div className="flex justify-end gap-1.5">
                        {s.status === 'pending' ? (
                          <form action={markPaidAction}>
                            <input type="hidden" name="id" value={s.id} />
                            <button type="submit" className="btn-ghost btn-sm">
                              รับเงินแล้ว
                            </button>
                          </form>
                        ) : null}
                        {s.status !== 'cancelled' ? (
                          <form action={cancelSaleAction}>
                            <input type="hidden" name="id" value={s.id} />
                            <ConfirmButton message={`ยกเลิกบิล ${s.code} และคืนสต๊อก?`}>
                              ยกเลิก
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
      </div>
    </>
  )
}
