import Link from 'next/link'
import { redirect } from 'next/navigation'
import { q } from '@/lib/db'
import { getShopCustomer } from '@/lib/shop'
import { dateTime, money, num } from '@/lib/format'
import { SALE_STATUS, type SaleStatus } from '@/lib/constants'

export const dynamic = 'force-dynamic'

const CREDIT_KINDS: Record<string, string> = {
  topup: 'ร้านเติมเครดิตให้',
  purchase: 'ใช้ซื้อสินค้า',
  refund: 'คืนเครดิต',
  adjust: 'ปรับยอดโดยร้าน',
}

export default async function ShopAccountPage() {
  const customer = await getShopCustomer()
  if (!customer) redirect('/shop/login')

  const [orders, credits] = await Promise.all([
    q<{
      code: string
      sold_at: string
      item_name: string
      game: string | null
      game_account: string | null
      qty: number
      total: number
      status: string
    }>(
      `select s.code, s.sold_at, s.item_name, g.name as game, s.game_account,
              s.qty, s.total::float8 as total, s.status
         from sales s left join games g on g.id = s.game_id
        where s.customer_id = $1
        order by s.sold_at desc limit 50`,
      [customer.id]
    ),
    q<{
      created_at: string
      kind: string
      amount: number
      balance_after: number
      note: string | null
    }>(
      `select created_at, kind, amount::float8 as amount,
              balance_after::float8 as balance_after, note
         from credit_transactions
        where customer_id = $1
        order by created_at desc limit 30`,
      [customer.id]
    ),
  ])

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-ink-700 bg-linear-to-r from-brand-600/20 to-grape-600/20 p-5">
        <div>
          <p className="text-sm text-mute">สวัสดี</p>
          <p className="text-xl font-bold text-white">{customer.name}</p>
          <p className="text-xs text-mute">{customer.email}</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-mute">เครดิตคงเหลือ</p>
          <p className="text-3xl font-bold text-good">{money(customer.credit)}</p>
          <p className="text-xs text-mute">บาท</p>
        </div>
      </div>

      <p className="mb-6 rounded-xl border border-ink-700/70 bg-ink-850/70 px-4 py-3 text-xs leading-relaxed text-mute backdrop-blur-sm">
        ต้องการเครดิตเพิ่ม? โอนเงินแล้วแจ้งพร้อมสลิปได้ที่หน้า{' '}
        <Link href="/shop/topup" className="text-brand-400 underline">
          เติมเครดิต
        </Link>{' '}
        ทางร้านจะตรวจสอบและเติมให้ —{' '}
        <Link href="/shop" className="text-brand-400 underline">
          เลือกเกมที่จะเติม
        </Link>
      </p>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold text-white">
          ประวัติการสั่งซื้อ
          <span className="ml-2 text-sm font-normal text-mute">{num(orders.length)} รายการ</span>
        </h2>
        {orders.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink-700/70 bg-ink-900/40 px-4 py-10 text-center text-sm text-mute backdrop-blur-sm">
            ยังไม่มีรายการสั่งซื้อ
          </div>
        ) : (
          <div className="card border-ink-700/70 bg-ink-900/75 backdrop-blur-md">
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>เลขที่</th>
                    <th>เวลา</th>
                    <th>รายการ</th>
                    <th>ไอดีที่เติม</th>
                    <th className="text-right">จำนวน</th>
                    <th className="text-right">ยอด</th>
                    <th>สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => {
                    const key = (o.status in SALE_STATUS ? o.status : 'paid') as SaleStatus
                    return (
                      <tr key={o.code}>
                        <td className="font-mono text-xs text-mute">{o.code}</td>
                        <td className="whitespace-nowrap text-xs text-mute">
                          {dateTime(o.sold_at)}
                        </td>
                        <td>
                          <span className="block text-slate-100">{o.item_name}</span>
                          <span className="block text-xs text-mute">{o.game ?? '-'}</span>
                        </td>
                        <td className="text-xs text-mute">{o.game_account ?? '-'}</td>
                        <td className="text-right">{num(o.qty)}</td>
                        <td className="text-right font-medium text-white">{money(o.total)}</td>
                        <td>
                          <span
                            className={`chip ${
                              key === 'paid'
                                ? 'bg-good/15 text-good'
                                : key === 'pending'
                                  ? 'bg-warn/15 text-warn'
                                  : 'bg-bad/15 text-bad'
                            }`}
                          >
                            {key === 'pending' ? 'กำลังดำเนินการ' : SALE_STATUS[key]}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">ประวัติเครดิต</h2>
        {credits.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink-700/70 bg-ink-900/40 px-4 py-10 text-center text-sm text-mute backdrop-blur-sm">
            ยังไม่มีการเคลื่อนไหวของเครดิต
          </div>
        ) : (
          <div className="card border-ink-700/70 bg-ink-900/75 backdrop-blur-md">
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>เวลา</th>
                    <th>รายการ</th>
                    <th className="text-right">จำนวน</th>
                    <th className="text-right">คงเหลือ</th>
                  </tr>
                </thead>
                <tbody>
                  {credits.map((c, i) => (
                    <tr key={`${c.created_at}-${i}`}>
                      <td className="whitespace-nowrap text-xs text-mute">
                        {dateTime(c.created_at)}
                      </td>
                      <td>
                        <span className="block text-slate-200">
                          {CREDIT_KINDS[c.kind] ?? c.kind}
                        </span>
                        {c.note ? <span className="block text-xs text-mute">{c.note}</span> : null}
                      </td>
                      <td
                        className={`text-right font-medium ${c.amount >= 0 ? 'text-good' : 'text-bad'}`}
                      >
                        {c.amount >= 0 ? '+' : ''}
                        {money(c.amount)}
                      </td>
                      <td className="text-right text-white">{money(c.balance_after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
