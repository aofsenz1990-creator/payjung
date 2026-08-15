import Link from 'next/link'
import { q, q1 } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import {
  deleteProviderAction,
  saveGameStorefrontAction,
  saveProviderAction,
  toggleGamePublishedAction,
  setAllProductsPublishedAction,
  testProviderAction,
  toggleProductPublishedAction,
} from '@/lib/actions/storefront'
import { deleteNewsAction, saveNewsAction, saveSiteSettingsAction } from '@/lib/actions/shop'
import { DEFAULT_SHOP_BG, DEFAULT_SHOP_COVER, getSiteSettings, SITE_KEYS } from '@/lib/shop'
import { ImageInput } from '@/components/ImageInput'
import { ProviderForm } from '@/components/ProviderForm'
import { importGameAction, syncCatalogAction } from '@/lib/actions/catalogSync'
import { dateOnly, money, num } from '@/lib/format'
import { ActionForm, ConfirmButton, SubmitButton } from '@/components/ActionForm'
import { Badge, Empty, PageHeader, SectionTitle } from '@/components/ui'

export const dynamic = 'force-dynamic'

type Provider = {
  id: number
  name: string
  kind: string
  base_url: string | null
  auth_type: string
  has_key: boolean
  note: string | null
  priority: number
  is_active: boolean
  products: number
}

type GameRow = {
  id: number
  name: string
  image_url: string | null
  description: string | null
  is_published: boolean
  sort_order: number
  published_products: number
  total_products: number
}

type ProductRow = {
  id: number
  game_id: number
  game: string
  name: string
  sell_price: number
  is_published: boolean
  provider_name: string | null
  provider_sku: string | null
}

type CatalogGame = {
  provider_id: number
  game_id: string
  game_name: string
  packs: number
  servers: number
  min_price: number
  max_price: number
  imported: number
  synced_at: string
}

type NewsRow = {
  id: number
  title: string
  body: string | null
  image_url: string | null
  link_url: string | null
  is_published: boolean
  pinned: boolean
  created_at: string
}

const AUTH_LABELS: Record<string, string> = {
  bearer: 'Bearer Token (ส่งใน Authorization)',
  apikey: 'API Key (ส่งใน header)',
  basic: 'Basic Auth (user:pass)',
  none: 'ไม่ต้องยืนยันตัวตน',
}

export default async function StorefrontPage({
  searchParams,
}: {
  searchParams: Promise<{ provider?: string; game?: string; cq?: string }>
}) {
  await requireAdmin()
  const { provider: editProvider, game: editGame, cq } = await searchParams
  const catalogSearch = (cq ?? '').trim()

  const [providers, games, products, editingProvider, editingGame, news, settings, catalog] =
    await Promise.all([
    q<Provider>(
      `select p.id, p.name, p.kind, p.base_url, p.auth_type, (p.api_key is not null) as has_key,
              p.note, p.priority, p.is_active,
              (select count(*) from products pr where pr.provider_id = p.id)::int as products
         from api_providers p order by p.priority, p.name`
    ),
    q<GameRow>(
      `select g.id, g.name, g.image_url, g.description, g.is_published, g.sort_order,
              (select count(*) from products p
                where p.game_id = g.id and p.is_published)::int as published_products,
              (select count(*) from products p where p.game_id = g.id)::int as total_products
         from games g order by g.is_published desc, g.sort_order, g.name`
    ),
    q<ProductRow>(
      `select p.id, p.game_id, g.name as game, p.name, p.sell_price::float8 as sell_price,
              p.is_published, ap.name as provider_name, p.provider_sku
         from products p
         join games g on g.id = p.game_id
         left join api_providers ap on ap.id = p.provider_id
        where p.is_active
        order by g.name, p.sell_price`
    ),
    editProvider
      ? q1<Provider>(
          `select id, name, kind, base_url, auth_type, (api_key is not null) as has_key,
                  note, priority, is_active
             from api_providers where id = $1`,
          [Number(editProvider)]
        )
      : Promise.resolve(null),
    editGame
      ? q1<GameRow>(
          'select id, name, image_url, description, is_published, sort_order from games where id = $1',
          [Number(editGame)]
        )
      : Promise.resolve(null),
      q<NewsRow>(
        `select id, title, body, image_url, link_url, is_published, pinned, created_at
           from news order by pinned desc, created_at desc`
      ),
      getSiteSettings(),
      q<CatalogGame>(
        `select c.provider_id, c.game_id, min(c.game_name) as game_name,
                count(*)::int as packs,
                count(distinct c.server_id)::int as servers,
                min(c.pack_price)::float8 as min_price,
                max(c.pack_price)::float8 as max_price,
                max(c.synced_at) as synced_at,
                (select count(*) from products pr
                  where pr.provider_id = c.provider_id
                    and pr.provider_game_id = c.game_id)::int as imported
           from provider_catalog c
          ${catalogSearch ? 'where c.game_name ilike $1' : ''}
          group by c.provider_id, c.game_id
          order by min(c.game_name)`,
        catalogSearch ? [`%${catalogSearch}%`] : []
      ),
    ])

  const publishedGames = games.filter((g) => g.is_published).length
  const publishedProducts = products.filter((p) => p.is_published).length
  const unmapped = products.filter((p) => p.is_published && !p.provider_name).length

  return (
    <>
      <PageHeader
        title="จัดการหน้าเว็บไซต์"
        subtitle="ตั้งค่าเกม รูปภาพ และแพ็กเกจที่จะแสดงบนหน้าเว็บสำหรับลูกค้า พร้อมผูกกับผู้ให้บริการ API ที่จะเติมให้"
      />

      <div className="mb-6 rounded-xl border border-good/30 bg-good/10 px-4 py-3 text-xs leading-relaxed text-good">
        <b>หน้าเว็บลูกค้าเปิดใช้งานแล้ว</b> —{' '}
        <a href="/shop" target="_blank" rel="noreferrer" className="underline">
          เปิดดูหน้าเว็บ ↗
        </a>{' '}
        ลูกค้าค้นหาเกม เลือกแพ็กเกจ ใส่จำนวน แล้วกดซื้อโดยตัดจากเครดิตที่ร้านเติมให้
        (เติมเครดิตได้ที่เมนู <b>รายชื่อลูกค้า</b>) ส่วนการยิงคำสั่งไปยัง API
        ของผู้ให้บริการยังไม่ได้ต่อ — ตอนนี้บิลจากเว็บจะขึ้นสถานะ “รอดำเนินการ” ให้ร้านเติมเอง
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="card">
          <p className="text-xs font-medium text-mute">เกมที่แสดงบนเว็บ</p>
          <p className="mt-2 text-2xl font-bold text-white">
            {num(publishedGames)}
            <span className="ml-1 text-sm font-medium text-mute">/ {num(games.length)} เกม</span>
          </p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-mute">แพ็กเกจที่เปิดขายบนเว็บ</p>
          <p className="mt-2 text-2xl font-bold text-white">
            {num(publishedProducts)}
            <span className="ml-1 text-sm font-medium text-mute">
              / {num(products.length)} รายการ
            </span>
          </p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-mute">ผู้ให้บริการ API</p>
          <p className="mt-2 text-2xl font-bold text-white">
            {num(providers.filter((p) => p.is_active).length)}
            <span className="ml-1 text-sm font-medium text-mute">เจ้าที่เปิดใช้</span>
          </p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-mute">แพ็กเกจที่ยังไม่ผูก API</p>
          <p className={`mt-2 text-2xl font-bold ${unmapped > 0 ? 'text-warn' : 'text-good'}`}>
            {num(unmapped)}
            <span className="ml-1 text-sm font-medium text-mute">รายการ</span>
          </p>
        </div>
      </div>

      {/* ---------------- ผู้ให้บริการ API ---------------- */}
      <div className="mb-6 grid gap-6 lg:grid-cols-[24rem_1fr]">
        <div className="card h-fit">
          <SectionTitle
            right={
              editingProvider ? (
                <Link href="/storefront" className="text-xs text-brand-400">
                  ยกเลิกการแก้ไข
                </Link>
              ) : undefined
            }
          >
            {editingProvider ? `แก้ไข: ${editingProvider.name}` : 'เพิ่มผู้ให้บริการ API'}
          </SectionTitle>

          <ProviderForm action={saveProviderAction} editing={editingProvider} />
        </div>

        <div className="card">
          <SectionTitle
            right={<span className="text-xs text-mute">{num(providers.length)} เจ้า</span>}
          >
            ผู้ให้บริการ API ที่ต่อไว้
          </SectionTitle>

          {/* ทดสอบว่าคีย์ใช้ได้จริงไหม */}
          {providers.length > 0 ? (
            <div className="mb-5 rounded-xl border border-ink-700 bg-ink-850 p-3">
              <p className="mb-2 text-sm font-medium text-slate-100">🔌 ทดสอบการเชื่อมต่อ</p>
              <ActionForm action={testProviderAction}>
                <div className="flex flex-wrap gap-2">
                  <select name="id" className="input w-auto flex-1" required defaultValue="">
                    <option value="" disabled>
                      — เลือกผู้ให้บริการ —
                    </option>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.kind})
                      </option>
                    ))}
                  </select>
                  <SubmitButton className="btn-primary" pendingLabel="กำลังต่อ...">
                    ทดสอบเดี๋ยวนี้
                  </SubmitButton>
                </div>
              </ActionForm>
              <p className="mt-2 text-xs leading-relaxed text-mute">
                ระบบจะเรียก <code className="text-slate-300">getAccount</code> และ{' '}
                <code className="text-slate-300">get_product_game</code> เพื่อเช็กว่าคีย์ใช้ได้
                และดูว่าเครดิตฝั่งผู้ให้บริการเหลือเท่าไหร่
              </p>
            </div>
          ) : null}
          {providers.length === 0 ? (
            <Empty>
              ยังไม่มีผู้ให้บริการ — เพิ่มเจ้าแรกจากฟอร์มด้านซ้าย เพิ่มได้หลายเจ้าพร้อมกัน
              แล้วเลือกทีหลังว่าแพ็กเกจไหนให้เจ้าไหนเติม
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>ชื่อ</th>
                    <th>ที่อยู่ API</th>
                    <th>ชนิด</th>
                    <th>คีย์</th>
                    <th className="text-right">แพ็กเกจที่ผูก</th>
                    <th className="text-right">ลำดับ</th>
                    <th>สถานะ</th>
                    <th className="text-right">จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {providers.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <span className="block font-medium text-white">{p.name}</span>
                        {p.note ? <span className="block text-xs text-mute">{p.note}</span> : null}
                      </td>
                      <td className="max-w-[16rem] truncate font-mono text-xs text-mute">
                        {p.base_url ?? '-'}
                      </td>
                      <td className="text-xs text-slate-300">{p.kind}</td>
                      <td>
                        {p.has_key ? (
                          <Badge tone="good">ตั้งแล้ว</Badge>
                        ) : (
                          <Badge tone="warn">ยังไม่ตั้ง</Badge>
                        )}
                      </td>
                      <td className="text-right">{num(p.products)}</td>
                      <td className="text-right text-mute">{num(p.priority)}</td>
                      <td>
                        {p.is_active ? (
                          <Badge tone="good">เปิดใช้</Badge>
                        ) : (
                          <Badge>ปิดอยู่</Badge>
                        )}
                      </td>
                      <td>
                        <div className="flex justify-end gap-1.5">
                          <Link
                            href={`/storefront?provider=${p.id}`}
                            className="btn-ghost btn-sm"
                          >
                            แก้ไข
                          </Link>
                          <form action={deleteProviderAction}>
                            <input type="hidden" name="id" value={p.id} />
                            <ConfirmButton
                              message={`ลบผู้ให้บริการ "${p.name}"? แพ็กเกจที่ผูกไว้จะกลายเป็นยังไม่ได้เลือกเจ้า`}
                            >
                              ลบ
                            </ConfirmButton>
                          </form>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ---------------- รายการสินค้าจากผู้ให้บริการ ---------------- */}
      {providers.length > 0 ? (
        <div className="card mb-6">
          <SectionTitle
            right={
              catalog.length > 0 ? (
                <span className="text-xs text-mute">
                  {num(catalog.length)} เกม · ดึงล่าสุด {dateOnly(catalog[0].synced_at)}
                </span>
              ) : undefined
            }
          >
            รายการเกมจากผู้ให้บริการ
          </SectionTitle>

          <div className="mb-4 rounded-xl border border-ink-700 bg-ink-850 p-3">
            <ActionForm action={syncCatalogAction}>
              <div className="flex flex-wrap gap-2">
                <select name="provider_id" className="input w-auto flex-1" required defaultValue="">
                  <option value="" disabled>
                    — เลือกผู้ให้บริการ —
                  </option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <SubmitButton className="btn-primary" pendingLabel="กำลังดึง...">
                  ⬇ ดึงรายการเกมทั้งหมด
                </SubmitButton>
              </div>
            </ActionForm>
            <p className="mt-2 text-xs leading-relaxed text-mute">
              ดึงเกม เซิร์ฟเวอร์ และแพ็กเกจทั้งหมดที่ผู้ให้บริการเปิดขายอยู่มาเก็บไว้
              แล้วกดนำเข้าทีละเกมได้เลย ไม่ต้องพิมพ์รหัสเกม/รหัสแพ็กเกจเอง
            </p>
          </div>

          <form method="get" className="mb-4 flex gap-2">
            <input
              name="cq"
              className="input"
              defaultValue={catalogSearch}
              placeholder="ค้นหาชื่อเกมจากรายการที่ดึงมา"
              aria-label="ค้นหาเกมจากผู้ให้บริการ"
            />
            <button type="submit" className="btn-ghost">
              ค้นหา
            </button>
            {catalogSearch ? (
              <Link href="/storefront" className="btn-ghost">
                ล้าง
              </Link>
            ) : null}
          </form>

          {catalog.length === 0 ? (
            <Empty>
              {catalogSearch
                ? `ไม่พบเกมที่ค้นหา "${catalogSearch}"`
                : 'ยังไม่ได้ดึงรายการ — กดปุ่มด้านบนเพื่อดึงจากผู้ให้บริการ'}
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>เกมฝั่งผู้ให้บริการ</th>
                    <th className="text-right">แพ็กเกจ</th>
                    <th className="text-right">ช่วงราคาทุน</th>
                    <th>สถานะในระบบเรา</th>
                    <th className="text-right">นำเข้า</th>
                  </tr>
                </thead>
                <tbody>
                  {catalog.map((g) => (
                    <tr key={`${g.provider_id}-${g.game_id}`}>
                      <td>
                        <span className="block font-medium text-white">{g.game_name}</span>
                        <span className="block font-mono text-xs text-mute">
                          game_id {g.game_id}
                          {g.servers > 1 ? ` · ${num(g.servers)} เซิร์ฟเวอร์` : ''}
                        </span>
                      </td>
                      <td className="text-right">{num(g.packs)}</td>
                      <td className="text-right text-mute">
                        {money(g.min_price)} – {money(g.max_price)}
                      </td>
                      <td>
                        {g.imported > 0 ? (
                          <Badge tone="good">นำเข้าแล้ว {num(g.imported)}</Badge>
                        ) : (
                          <Badge tone="warn">ยังไม่นำเข้า</Badge>
                        )}
                      </td>
                      <td>
                        <ActionForm action={importGameAction}>
                          <div className="flex items-center justify-end gap-1.5">
                            <input type="hidden" name="provider_id" value={g.provider_id} />
                            <input type="hidden" name="game_id" value={g.game_id} />
                            <input
                              name="markup"
                              type="number"
                              min={0}
                              step="0.01"
                              className="input w-24 py-1 text-xs"
                              placeholder="บวกกำไร"
                              defaultValue={0}
                              title="บวกกำไรต่อแพ็ก (บาท) — ปล่อย 0 = ขายเท่าทุน"
                            />
                            <SubmitButton className="btn-ghost btn-sm" pendingLabel="...">
                              นำเข้า
                            </SubmitButton>
                          </div>
                        </ActionForm>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {/* ---------------- เกมบนหน้าเว็บ ---------------- */}
      <div className="mb-6 grid gap-6 lg:grid-cols-[24rem_1fr]">
        <div className="card h-fit">
          <SectionTitle
            right={
              editingGame ? (
                <Link href="/storefront" className="text-xs text-brand-400">
                  ปิด
                </Link>
              ) : undefined
            }
          >
            {editingGame ? `หน้าเว็บของ: ${editingGame.name}` : 'ตั้งค่าเกมบนหน้าเว็บ'}
          </SectionTitle>

          {editingGame ? (
            <ActionForm key={editingGame.id} action={saveGameStorefrontAction} className="space-y-4">
              <input type="hidden" name="id" value={editingGame.id} />
              <div>
                <label className="label" htmlFor="image_url">
                  ลิงก์รูปเกม
                </label>
                <input
                  id="image_url"
                  name="image_url"
                  className="input"
                  defaultValue={editingGame.image_url ?? ''}
                  placeholder="https://..."
                />
              </div>
              {editingGame.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={editingGame.image_url}
                  alt={editingGame.name}
                  className="h-32 w-full rounded-lg border border-ink-700 bg-ink-850 object-contain p-2"
                />
              ) : null}
              <div>
                <label className="label" htmlFor="description">
                  คำอธิบายสั้น ๆ
                </label>
                <input
                  id="description"
                  name="description"
                  className="input"
                  defaultValue={editingGame.description ?? ''}
                  placeholder="เช่น เติมเพชรฟรีไฟร์ เข้าไวใน 1 นาที"
                />
              </div>
              <div>
                <label className="label" htmlFor="sort_order">
                  ลำดับการแสดง (เลขน้อยขึ้นก่อน)
                </label>
                <input
                  id="sort_order"
                  name="sort_order"
                  type="number"
                  className="input"
                  defaultValue={editingGame.sort_order}
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-200">
                <input
                  type="checkbox"
                  name="is_published"
                  defaultChecked={editingGame.is_published}
                  className="size-4 rounded border-ink-600 bg-ink-850"
                />
                แสดงเกมนี้บนหน้าเว็บลูกค้า
              </label>
              <SubmitButton className="btn-primary w-full">บันทึก</SubmitButton>
            </ActionForm>
          ) : (
            <p className="text-xs leading-relaxed text-mute">
              เลือกเกมจากตารางด้านขวาเพื่อตั้งค่ารูป คำอธิบาย และลำดับการแสดงบนหน้าเว็บ
              <br />
              <br />
              ส่วนราคาและแพ็กเกจยังแก้ที่เมนู{' '}
              <Link href="/games" className="text-brand-400 underline">
                รายชื่อเกม &amp; แพ็กเกจ
              </Link>{' '}
              เหมือนเดิม ที่นั่นจะมีช่องให้เลือกผู้ให้บริการ API ของแต่ละแพ็กเกจด้วย
            </p>
          )}
        </div>

        <div className="card">
          <SectionTitle right={<span className="text-xs text-mute">{num(games.length)} เกม</span>}>
            เกมบนหน้าเว็บ
          </SectionTitle>
          {games.length === 0 ? (
            <Empty>ยังไม่มีเกมในระบบ</Empty>
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>รูป</th>
                    <th>เกม</th>
                    <th className="text-right">ลำดับ</th>
                    <th className="text-right">แพ็กเกจที่เปิดขาย</th>
                    <th>สถานะบนเว็บ</th>
                    <th className="text-right">จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {games.map((g) => (
                    <tr key={g.id}>
                      <td>
                        {g.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={g.image_url}
                            alt={g.name}
                            className="size-10 rounded-lg border border-ink-700 bg-ink-850 object-contain p-0.5"
                          />
                        ) : (
                          <span className="flex size-10 items-center justify-center rounded-lg border border-dashed border-ink-700 text-xs text-mute">
                            ไม่มี
                          </span>
                        )}
                      </td>
                      <td>
                        <span className="block font-medium text-white">{g.name}</span>
                        {g.description ? (
                          <span className="block max-w-[18rem] truncate text-xs text-mute">
                            {g.description}
                          </span>
                        ) : null}
                      </td>
                      <td className="text-right text-mute">{num(g.sort_order)}</td>
                      <td className="text-right">
                        <span className={g.published_products === 0 ? 'text-warn' : 'text-white'}>
                          {num(g.published_products)}
                        </span>
                        <span className="text-mute"> / {num(g.total_products)}</span>
                      </td>
                      <td>
                        {g.is_published ? (
                          <Badge tone="good">แสดงอยู่</Badge>
                        ) : (
                          <Badge>ซ่อนอยู่</Badge>
                        )}
                      </td>
                      <td>
                        <div className="flex justify-end gap-1.5">
                          <Link href={`/storefront?game=${g.id}`} className="btn-ghost btn-sm">
                            ตั้งค่า
                          </Link>
                          <form action={toggleGamePublishedAction}>
                            <input type="hidden" name="id" value={g.id} />
                            <button type="submit" className="btn-ghost btn-sm">
                              {g.is_published ? 'ซ่อน' : 'แสดง'}
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ---------------- แพ็กเกจกับการผูก API ---------------- */}
      <div className="card">
        <SectionTitle
          right={
            <Link href="/games" className="text-xs text-brand-400">
              แก้ราคา/แพ็กเกจ
            </Link>
          }
        >
          แพ็กเกจกับผู้ให้บริการที่จะเติมให้
        </SectionTitle>

        {products.length > 0 ? (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-ink-700 bg-ink-850 p-3">
            <span className="text-xs text-mute">
              เปิด/ปิดขายทีเดียวทั้งหมด ({num(publishedProducts)} จาก {num(products.length)}{' '}
              เปิดขายอยู่)
            </span>
            <div className="ml-auto flex flex-wrap gap-2">
              <ActionForm action={setAllProductsPublishedAction}>
                <input type="hidden" name="published" value="1" />
                <SubmitButton className="btn-primary btn-sm" pendingLabel="...">
                  เปิดขายทั้งหมด
                </SubmitButton>
              </ActionForm>
              <ActionForm action={setAllProductsPublishedAction}>
                <input type="hidden" name="published" value="0" />
                {/* ถามยืนยันก่อน เพราะกดพลาดทีเดียวหน้าเว็บจะไม่เหลือของขายเลย */}
                <ConfirmButton
                  className="btn-ghost btn-sm"
                  message={`ซ่อนแพ็กเกจทั้งหมด ${products.length} รายการจากหน้าเว็บลูกค้า?`}
                >
                  ซ่อนทั้งหมด
                </ConfirmButton>
              </ActionForm>
            </div>
          </div>
        ) : null}
        {products.length === 0 ? (
          <Empty>ยังไม่มีแพ็กเกจ</Empty>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>เกม</th>
                  <th>แพ็กเกจ</th>
                  <th className="text-right">ราคาขาย</th>
                  <th>ผู้ให้บริการ</th>
                  <th>รหัสสินค้าฝั่งผู้ให้บริการ</th>
                  <th>สถานะบนเว็บ</th>
                  <th className="text-right">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id}>
                    <td className="text-slate-300">{p.game}</td>
                    <td className="font-medium text-white">{p.name}</td>
                    <td className="text-right">{money(p.sell_price)}</td>
                    <td>
                      {p.provider_name ? (
                        <Badge tone="brand">{p.provider_name}</Badge>
                      ) : (
                        <Badge tone="warn">ยังไม่ผูก</Badge>
                      )}
                    </td>
                    <td className="font-mono text-xs text-mute">{p.provider_sku ?? '-'}</td>
                    <td>
                      {p.is_published ? (
                        <Badge tone="good">เปิดขาย</Badge>
                      ) : (
                        <Badge>ซ่อนอยู่</Badge>
                      )}
                    </td>
                    <td>
                      <div className="flex justify-end gap-1.5">
                        <Link
                          href={`/games/${p.game_id}?edit=${p.id}`}
                          className="btn-ghost btn-sm"
                        >
                          แก้ไข
                        </Link>
                        <form action={toggleProductPublishedAction}>
                          <input type="hidden" name="id" value={p.id} />
                          <button type="submit" className="btn-ghost btn-sm">
                            {p.is_published ? 'ซ่อน' : 'เปิดขาย'}
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---------------- ข่าวสาร + ช่องทางติดต่อ ---------------- */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[24rem_1fr]">
        <div className="space-y-6">
          <div className="card h-fit">
            <SectionTitle>ตั้งค่าหน้าเว็บ &amp; ช่องทางติดต่อ</SectionTitle>
            <ActionForm action={saveSiteSettingsAction} className="space-y-3">
              {SITE_KEYS.map((s) => (
                <div key={s.key}>
                  <label className="label" htmlFor={`setting_${s.key}`}>
                    {s.label}
                  </label>
                  {'image' in s ? (
                    <ImageInput
                      name={`${s.key}_data`}
                      urlName={`setting_${s.key}`}
                      maxDimension={s.key === 'shop_bg' || s.key === 'shop_cover' ? 1920 : 800}
                      forceJpeg={s.key === 'shop_bg' || s.key === 'shop_cover'}
                      previewClassName={s.key === 'shop_bg' || s.key === 'shop_cover' ? 'h-24 w-40' : 'size-24'}
                      currentUrl={
                        settings[s.key] ??
                        (s.key === 'shop_bg'
                          ? DEFAULT_SHOP_BG
                          : s.key === 'shop_cover'
                            ? DEFAULT_SHOP_COVER
                            : null)
                      }
                      label=""
                      hint={
                        s.key === 'shop_cover'
                          ? 'พื้นหลังของแถบเมนูด้านบน (แถบที่มีโลโก้กับปุ่มเข้าสู่ระบบ) แนะนำภาพแนวนอนยาว ๆ ประมาณ 2000 x 350 px — แถบเตี้ยกว่าภาพมาก ระบบจะครอบเอาเฉพาะกลางภาพ'
                          : s.key === 'shop_bg'
                          ? 'ภาพนี้จะเป็นพื้นหลังของหน้าเว็บลูกค้า แนะนำภาพแนวนอนที่ตรงกลางไม่มีลาย'
                          : 'อัปโหลดรูป QR จากแอป LINE — ลูกค้ากดที่ปุ่ม LINE ท้ายเว็บแล้วจะเห็น QR นี้'
                      }
                    />
                  ) : 'options' in s ? (
                    <select
                      id={`setting_${s.key}`}
                      name={`setting_${s.key}`}
                      className="input"
                      defaultValue={settings[s.key] ?? s.options[0].value}
                    >
                      {s.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={`setting_${s.key}`}
                      name={`setting_${s.key}`}
                      className="input"
                      defaultValue={settings[s.key] ?? ''}
                      placeholder={s.placeholder}
                    />
                  )}
                </div>
              ))}
              <SubmitButton className="btn-primary w-full">บันทึกการตั้งค่า</SubmitButton>
            </ActionForm>
          </div>

          <div className="card h-fit">
            <SectionTitle>เพิ่มข่าวสาร</SectionTitle>
            <ActionForm action={saveNewsAction} className="space-y-3" resetOnSuccess>
              <div>
                <label className="label" htmlFor="title">
                  หัวข้อ
                </label>
                <input id="title" name="title" className="input" required />
              </div>
              <div>
                <label className="label" htmlFor="body">
                  เนื้อหา
                </label>
                <textarea id="body" name="body" className="input" rows={3} />
              </div>
              <ImageInput
                label="รูปข่าว"
                hint="แสดงเป็นภาพหัวข่าวบนหน้าเว็บ แนะนำภาพแนวนอน — คลิกเลือกไฟล์ ลากมาวาง หรือ Ctrl+V"
                maxDimension={1200}
                forceJpeg
                previewClassName="h-24 w-32"
              />
              <div>
                <label className="label" htmlFor="link_url">
                  ลิงก์เมื่อกด (ถ้ามี)
                </label>
                <input id="link_url" name="link_url" className="input" placeholder="https://..." />
              </div>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    name="is_published"
                    defaultChecked
                    className="size-4 rounded border-ink-600 bg-ink-850"
                  />
                  แสดงบนเว็บ
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    name="pinned"
                    className="size-4 rounded border-ink-600 bg-ink-850"
                  />
                  ปักหมุดขึ้นก่อน
                </label>
              </div>
              <SubmitButton className="btn-primary w-full">เพิ่มข่าว</SubmitButton>
            </ActionForm>
          </div>
        </div>

        <div className="card">
          <SectionTitle right={<span className="text-xs text-mute">{num(news.length)} ข่าว</span>}>
            ข่าวสารที่แสดงด้านล่างหน้าเว็บ
          </SectionTitle>
          {news.length === 0 ? (
            <Empty>ยังไม่มีข่าวสาร เพิ่มข่าวแรกจากฟอร์มด้านซ้าย</Empty>
          ) : (
            <div className="space-y-3">
              {news.map((n) => (
                <div
                  key={n.id}
                  className="flex gap-3 rounded-xl border border-ink-700 bg-ink-850 p-3"
                >
                  {n.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={n.image_url}
                      alt={n.title}
                      className="size-16 shrink-0 rounded-lg object-cover"
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-white">{n.title}</span>
                      {n.pinned ? <Badge tone="brand">ปักหมุด</Badge> : null}
                      {n.is_published ? (
                        <Badge tone="good">แสดงอยู่</Badge>
                      ) : (
                        <Badge>ซ่อนอยู่</Badge>
                      )}
                    </div>
                    {n.body ? (
                      <p className="mt-1 line-clamp-2 text-xs text-mute">{n.body}</p>
                    ) : null}
                    <p className="mt-1 text-xs text-mute">{dateOnly(n.created_at)}</p>
                  </div>
                  <form action={deleteNewsAction} className="shrink-0">
                    <input type="hidden" name="id" value={n.id} />
                    <ConfirmButton message={`ลบข่าว "${n.title}"?`}>ลบ</ConfirmButton>
                  </form>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
