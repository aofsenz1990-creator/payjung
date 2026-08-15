import Link from 'next/link'
import { notFound } from 'next/navigation'
import { q, q1 } from '@/lib/db'
import { requirePage } from '@/lib/auth'
import { deleteProductAction, saveProductAction } from '@/lib/actions/catalog'
import { money, num } from '@/lib/format'
import { ActionForm, ConfirmButton, SubmitButton } from '@/components/ActionForm'
import { Badge, Empty, PageHeader, SectionTitle } from '@/components/ui'

export const dynamic = 'force-dynamic'

type ProductRow = {
  id: number
  game_id: number
  name: string
  sku: string | null
  cost_price: number
  sell_price: number
  track_stock: boolean
  stock_qty: number
  low_stock: number
  is_active: boolean
  sold: number
  image_url: string | null
  is_published: boolean
  sort_order: number
  provider_id: number | null
  provider_sku: string | null
}

export default async function GameDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ edit?: string }>
}) {
  const user = await requirePage('games')
  const isAdmin = user.role === 'admin'
  const { id } = await params
  const { edit } = await searchParams
  const gameId = Number(id)
  if (!Number.isFinite(gameId)) notFound()

  const [game, products, editing, providers] = await Promise.all([
    q1<{ id: number; name: string; publisher: string | null; note: string | null }>(
      'select id, name, publisher, note from games where id = $1',
      [gameId]
    ),
    q<ProductRow>(
      `select p.id, p.game_id, p.name, p.sku, p.cost_price::float8 as cost_price,
              p.sell_price::float8 as sell_price, p.track_stock, p.stock_qty, p.low_stock,
              p.is_active,
              coalesce((select sum(s.qty) from sales s
                         where s.product_id = p.id and s.status = 'paid'), 0)::int as sold
         from products p where p.game_id = $1
        order by p.is_active desc, p.sell_price`,
      [gameId]
    ),
    edit
      ? q1<ProductRow>(
          `select id, game_id, name, sku, cost_price::float8 as cost_price,
                  sell_price::float8 as sell_price, track_stock, stock_qty, low_stock, is_active,
                  image_url, is_published, sort_order, provider_id, provider_sku
             from products where id = $1`,
          [Number(edit)]
        )
      : Promise.resolve(null),
    q<{ id: number; name: string }>(
      'select id, name from api_providers where is_active order by priority, name'
    ),
  ])

  if (!game) notFound()

  return (
    <>
      <PageHeader
        title={game.name}
        subtitle={`แพ็กเกจเติมของเกมนี้${game.publisher ? ` · ${game.publisher}` : ''}`}
      >
        <Link href="/games" className="btn-ghost">
          ← กลับรายชื่อเกม
        </Link>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[24rem_1fr]">
        <div className="card h-fit">
          <SectionTitle
            right={
              editing ? (
                <Link href={`/games/${gameId}`} className="text-xs text-brand-400">
                  ยกเลิกการแก้ไข
                </Link>
              ) : undefined
            }
          >
            {editing ? `แก้ไข: ${editing.name}` : 'เพิ่มแพ็กเกจ'}
          </SectionTitle>

          <ActionForm
            key={editing?.id ?? 'new'}
            action={saveProductAction}
            className="space-y-4"
            resetOnSuccess={!editing}
          >
            {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
            <input type="hidden" name="game_id" value={gameId} />

            <div>
              <label className="label" htmlFor="name">
                ชื่อแพ็กเกจ
              </label>
              <input
                id="name"
                name="name"
                className="input"
                defaultValue={editing?.name ?? ''}
                placeholder="เช่น 100 เพชร, บัตร 300 บาท"
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="sku">
                รหัสสินค้า (ถ้ามี)
              </label>
              <input
                id="sku"
                name="sku"
                className="input"
                defaultValue={editing?.sku ?? ''}
                placeholder="ไม่บังคับ"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="cost_price">
                  ต้นทุน / หน่วย
                </label>
                <input
                  id="cost_price"
                  name="cost_price"
                  type="number"
                  min={0}
                  step="0.01"
                  className="input"
                  defaultValue={editing?.cost_price ?? ''}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="label" htmlFor="sell_price">
                  ราคาขาย / หน่วย
                </label>
                <input
                  id="sell_price"
                  name="sell_price"
                  type="number"
                  min={0}
                  step="0.01"
                  className="input"
                  defaultValue={editing?.sell_price ?? ''}
                  placeholder="0.00"
                  required
                />
              </div>
            </div>

            <div className="rounded-xl border border-ink-700 bg-ink-850 p-3">
              <label className="flex items-center gap-2 text-sm font-medium text-slate-100">
                <input
                  type="checkbox"
                  name="track_stock"
                  defaultChecked={editing?.track_stock ?? false}
                  className="size-4 rounded border-ink-600 bg-ink-900"
                />
                นับสต๊อกแพ็กเกจนี้
              </label>
              <p className="mt-1.5 text-xs leading-relaxed text-mute">
                เปิดไว้ถ้าเป็นบัตร/โค้ดที่ซื้อมาเก็บไว้ล่วงหน้า
                ระบบจะตัดสต๊อกให้อัตโนมัติทุกครั้งที่ลงยอดขาย ถ้าเป็นการเติมผ่านไอดีโดยตรงให้ปิดไว้
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                {editing ? (
                  <div>
                    <label className="label">คงเหลือปัจจุบัน</label>
                    <p className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-white">
                      {num(editing.stock_qty)} ชิ้น
                    </p>
                  </div>
                ) : (
                  <div>
                    <label className="label" htmlFor="opening_qty">
                      สต๊อกยกมา
                    </label>
                    <input
                      id="opening_qty"
                      name="opening_qty"
                      type="number"
                      min={0}
                      step={1}
                      className="input"
                      defaultValue={0}
                    />
                  </div>
                )}
                <div>
                  <label className="label" htmlFor="low_stock">
                    แจ้งเตือนเมื่อเหลือ
                  </label>
                  <input
                    id="low_stock"
                    name="low_stock"
                    type="number"
                    min={0}
                    step={1}
                    className="input"
                    defaultValue={editing?.low_stock ?? 5}
                  />
                </div>
              </div>
              {editing ? (
                <p className="mt-2 text-xs text-mute">
                  แก้จำนวนคงเหลือได้ที่หน้า{' '}
                  <Link href="/stock" className="text-brand-400 underline">
                    ระบบสต๊อก
                  </Link>
                </p>
              ) : null}
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-200">
              <input
                type="checkbox"
                name="is_active"
                defaultChecked={editing ? editing.is_active : true}
                className="size-4 rounded border-ink-600 bg-ink-850"
              />
              เปิดขายอยู่ (ในระบบหลังร้าน)
            </label>

            {/* ส่วนของหน้าเว็บลูกค้า */}
            <div className="rounded-xl border border-ink-700 bg-ink-850 p-3">
              <p className="text-sm font-medium text-slate-100">🛒 หน้าเว็บสำหรับลูกค้า</p>
              <p className="mt-1 text-xs leading-relaxed text-mute">
                ใช้ตอนเปิดเว็บให้ลูกค้ากดซื้อเอง ตอนนี้ตั้งค่าเก็บไว้ก่อนได้
              </p>

              <div className="mt-3 space-y-3">
                <div>
                  <label className="label" htmlFor="image_url">
                    ลิงก์รูปแพ็กเกจ
                  </label>
                  <input
                    id="image_url"
                    name="image_url"
                    className="input"
                    defaultValue={editing?.image_url ?? ''}
                    placeholder="https://..."
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label" htmlFor="provider_id">
                      ผู้ให้บริการที่เติมให้
                    </label>
                    <select
                      id="provider_id"
                      name="provider_id"
                      className="input"
                      defaultValue={editing?.provider_id ?? ''}
                    >
                      <option value="">— ยังไม่ผูก —</option>
                      {providers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label" htmlFor="provider_sku">
                      รหัสสินค้าฝั่งผู้ให้บริการ
                    </label>
                    <input
                      id="provider_sku"
                      name="provider_sku"
                      className="input"
                      defaultValue={editing?.provider_sku ?? ''}
                      placeholder="เช่น ff_100_diamond"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label" htmlFor="sort_order">
                      ลำดับการแสดง
                    </label>
                    <input
                      id="sort_order"
                      name="sort_order"
                      type="number"
                      className="input"
                      defaultValue={editing?.sort_order ?? 100}
                    />
                  </div>
                  <div className="flex items-end pb-2">
                    <label className="flex items-center gap-2 text-sm text-slate-200">
                      <input
                        type="checkbox"
                        name="is_published"
                        defaultChecked={editing?.is_published ?? false}
                        className="size-4 rounded border-ink-600 bg-ink-900"
                      />
                      แสดงบนเว็บ
                    </label>
                  </div>
                </div>
                {providers.length === 0 ? (
                  <p className="text-xs text-warn">
                    ยังไม่มีผู้ให้บริการ API —{' '}
                    <Link href="/storefront" className="underline">
                      เพิ่มที่หน้าจัดการหน้าเว็บไซต์
                    </Link>
                  </p>
                ) : null}
              </div>
            </div>

            <SubmitButton className="btn-primary w-full">
              {editing ? 'บันทึกการแก้ไข' : 'เพิ่มแพ็กเกจ'}
            </SubmitButton>
          </ActionForm>
        </div>

        <div className="card">
          <SectionTitle
            right={<span className="text-xs text-mute">{num(products.length)} แพ็กเกจ</span>}
          >
            แพ็กเกจของ {game.name}
          </SectionTitle>
          {products.length === 0 ? (
            <Empty>ยังไม่มีแพ็กเกจ เพิ่มจากฟอร์มด้านซ้าย</Empty>
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>แพ็กเกจ</th>
                    {isAdmin ? <th className="text-right">ต้นทุน</th> : null}
                    <th className="text-right">ราคาขาย</th>
                    {isAdmin ? <th className="text-right">กำไร/หน่วย</th> : null}
                    <th className="text-right">สต๊อก</th>
                    <th className="text-right">ขายไปแล้ว</th>
                    <th>สถานะ</th>
                    <th className="text-right">จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => {
                    const margin = p.sell_price - p.cost_price
                    return (
                      <tr key={p.id}>
                        <td>
                          <span className="block font-medium text-white">{p.name}</span>
                          {p.sku ? (
                            <span className="block font-mono text-xs text-mute">{p.sku}</span>
                          ) : null}
                        </td>
                        {isAdmin ? (
                          <td className="text-right text-mute">{money(p.cost_price)}</td>
                        ) : null}
                        <td className="text-right font-medium text-white">
                          {money(p.sell_price)}
                        </td>
                        {isAdmin ? (
                          <td className={`text-right ${margin >= 0 ? 'text-good' : 'text-bad'}`}>
                            {money(margin)}
                          </td>
                        ) : null}
                        <td className="text-right">
                          {p.track_stock ? (
                            <span
                              className={
                                p.stock_qty <= p.low_stock ? 'font-medium text-warn' : 'text-white'
                              }
                            >
                              {num(p.stock_qty)}
                            </span>
                          ) : (
                            <span className="text-xs text-mute">ไม่นับสต๊อก</span>
                          )}
                        </td>
                        <td className="text-right text-slate-300">{num(p.sold)}</td>
                        <td>
                          {p.is_active ? <Badge tone="good">เปิดขาย</Badge> : <Badge>ปิดขาย</Badge>}
                        </td>
                        <td>
                          <div className="flex justify-end gap-1.5">
                            <Link
                              href={`/games/${gameId}?edit=${p.id}`}
                              className="btn-ghost btn-sm"
                            >
                              แก้ไข
                            </Link>
                            {isAdmin ? (
                              <form action={deleteProductAction}>
                                <input type="hidden" name="id" value={p.id} />
                                <ConfirmButton message={`ลบแพ็กเกจ "${p.name}"?`}>ลบ</ConfirmButton>
                              </form>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
