import Link from 'next/link'
import { q, q1 } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { stockMoveAction } from '@/lib/actions/stock'
import { dateTime, money, num } from '@/lib/format'
import { StockForm, type StockProduct } from '@/components/StockForm'
import { Badge, Empty, MoneyStat, PageHeader, SectionTitle } from '@/components/ui'
import { STOCK_KIND } from '@/lib/constants'

export const dynamic = 'force-dynamic'

export default async function StockPage() {
  const user = await requireUser()
  const isAdmin = user.role === 'admin'

  const [products, movements, summary] = await Promise.all([
    q<StockProduct & { low_stock: number; sell_price: number; is_active: boolean }>(
      `select p.id, p.name, g.name as game, p.stock_qty, p.low_stock,
              p.cost_price::float8 as cost_price, p.sell_price::float8 as sell_price, p.is_active
         from products p join games g on g.id = p.game_id
        where p.track_stock
        order by (p.stock_qty <= p.low_stock) desc, g.name, p.name`
    ),
    q<{
      id: number
      created_at: string
      kind: string
      qty: number
      unit_cost: number
      note: string | null
      product: string
      game: string
      user_name: string | null
      sale_code: string | null
    }>(
      `select m.id, m.created_at, m.kind, m.qty, m.unit_cost::float8 as unit_cost, m.note,
              p.name as product, g.name as game, u.display_name as user_name, s.code as sale_code
         from stock_movements m
         join products p on p.id = m.product_id
         join games g on g.id = p.game_id
         left join profiles u on u.id = m.created_by
         left join sales s on s.id = m.sale_id
        order by m.created_at desc, m.id desc
        limit 40`
    ),
    q1<{ items: number; units: number; value: number; low: number }>(
      `select count(*)::int as items,
              coalesce(sum(stock_qty), 0)::int as units,
              coalesce(sum(stock_qty * cost_price), 0)::float8 as value,
              (count(*) filter (where stock_qty <= low_stock))::int as low
         from products where track_stock and is_active`
    ),
  ])

  const s = summary ?? { items: 0, units: 0, value: 0, low: 0 }

  return (
    <>
      <PageHeader
        title="ระบบสต๊อก"
        subtitle="ใช้กับแพ็กเกจที่ตั้งค่า “นับสต๊อก” ไว้ เช่น บัตรเติมเงินหรือโค้ดที่ซื้อมาเก็บล่วงหน้า"
      >
        <Link href="/games" className="btn-ghost">
          จัดการแพ็กเกจ
        </Link>
      </PageHeader>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="card">
          <p className="text-xs font-medium text-mute">แพ็กเกจที่นับสต๊อก</p>
          <p className="mt-2 text-2xl font-bold text-white">
            {num(s.items)}
            <span className="ml-1 text-sm font-medium text-mute">รายการ</span>
          </p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-mute">จำนวนคงเหลือรวม</p>
          <p className="mt-2 text-2xl font-bold text-white">
            {num(s.units)}
            <span className="ml-1 text-sm font-medium text-mute">ชิ้น</span>
          </p>
        </div>
        {isAdmin ? (
          <MoneyStat label="มูลค่าสต๊อก (ตามต้นทุน)" amount={s.value} />
        ) : (
          <div className="card">
            <p className="text-xs font-medium text-mute">รายการใกล้หมด</p>
            <p className="mt-2 text-2xl font-bold text-warn">{num(s.low)}</p>
          </div>
        )}
        <div className="card">
          <p className="text-xs font-medium text-mute">ต้องเติมสต๊อก</p>
          <p className={`mt-2 text-2xl font-bold ${s.low > 0 ? 'text-warn' : 'text-good'}`}>
            {num(s.low)}
            <span className="ml-1 text-sm font-medium text-mute">รายการ</span>
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[24rem_1fr]">
        <div className="card h-fit">
          <SectionTitle>รับเข้า / ปรับสต๊อก</SectionTitle>
          {products.length === 0 ? (
            <Empty>
              ยังไม่มีแพ็กเกจที่เปิด “นับสต๊อก” —{' '}
              <Link href="/games" className="text-brand-400 underline">
                ตั้งค่าที่หน้าเกม
              </Link>
            </Empty>
          ) : (
            <StockForm action={stockMoveAction} products={products} />
          )}
        </div>

        <div className="space-y-6">
          <div className="card">
            <SectionTitle
              right={<span className="text-xs text-mute">{num(products.length)} รายการ</span>}
            >
              สต๊อกคงเหลือ
            </SectionTitle>
            {products.length === 0 ? (
              <Empty>ยังไม่มีข้อมูลสต๊อก</Empty>
            ) : (
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>เกม</th>
                      <th>แพ็กเกจ</th>
                      <th className="text-right">คงเหลือ</th>
                      <th className="text-right">จุดเตือน</th>
                      {isAdmin ? <th className="text-right">ทุน/หน่วย</th> : null}
                      {isAdmin ? <th className="text-right">มูลค่า</th> : null}
                      <th>สถานะ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((p) => (
                      <tr key={p.id}>
                        <td className="text-slate-300">{p.game}</td>
                        <td className="font-medium text-white">{p.name}</td>
                        <td className="text-right font-medium">
                          <span
                            className={
                              p.stock_qty === 0
                                ? 'text-bad'
                                : p.stock_qty <= p.low_stock
                                  ? 'text-warn'
                                  : 'text-white'
                            }
                          >
                            {num(p.stock_qty)}
                          </span>
                        </td>
                        <td className="text-right text-mute">{num(p.low_stock)}</td>
                        {isAdmin ? (
                          <td className="text-right text-mute">{money(p.cost_price)}</td>
                        ) : null}
                        {isAdmin ? (
                          <td className="text-right text-white">
                            {money(p.stock_qty * p.cost_price)}
                          </td>
                        ) : null}
                        <td>
                          {p.stock_qty === 0 ? (
                            <Badge tone="bad">หมด</Badge>
                          ) : p.stock_qty <= p.low_stock ? (
                            <Badge tone="warn">ใกล้หมด</Badge>
                          ) : (
                            <Badge tone="good">ปกติ</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <SectionTitle>ประวัติการเคลื่อนไหวล่าสุด</SectionTitle>
            {movements.length === 0 ? (
              <Empty>ยังไม่มีการเคลื่อนไหวสต๊อก</Empty>
            ) : (
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>เวลา</th>
                      <th>แพ็กเกจ</th>
                      <th>ประเภท</th>
                      <th className="text-right">จำนวน</th>
                      <th>อ้างอิง</th>
                      <th>โดย</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((m) => {
                      const kind = (m.kind in STOCK_KIND ? m.kind : 'adjust') as keyof typeof STOCK_KIND
                      const sign = kind === 'in' ? '+' : kind === 'out' ? '−' : m.qty >= 0 ? '+' : '−'
                      return (
                        <tr key={m.id}>
                          <td className="whitespace-nowrap text-xs text-mute">
                            {dateTime(m.created_at)}
                          </td>
                          <td>
                            <span className="block text-slate-100">{m.product}</span>
                            <span className="block text-xs text-mute">{m.game}</span>
                          </td>
                          <td>
                            <Badge tone={kind === 'in' ? 'good' : kind === 'out' ? 'bad' : 'warn'}>
                              {STOCK_KIND[kind]}
                            </Badge>
                          </td>
                          <td className="text-right font-medium text-white">
                            {sign}
                            {num(Math.abs(m.qty))}
                          </td>
                          <td className="text-xs text-mute">
                            {m.sale_code ? (
                              <span className="font-mono">{m.sale_code}</span>
                            ) : (
                              (m.note ?? '-')
                            )}
                          </td>
                          <td className="text-xs text-mute">{m.user_name ?? 'ระบบ'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
