import Link from 'next/link'
import { q, q1 } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import {
  deleteProviderAction,
  saveGameStorefrontAction,
  saveProviderAction,
  toggleGamePublishedAction,
  toggleProductPublishedAction,
} from '@/lib/actions/storefront'
import { money, num } from '@/lib/format'
import { ActionForm, ConfirmButton, SubmitButton } from '@/components/ActionForm'
import { Badge, Empty, PageHeader, SectionTitle } from '@/components/ui'

export const dynamic = 'force-dynamic'

type Provider = {
  id: number
  name: string
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

const AUTH_LABELS: Record<string, string> = {
  bearer: 'Bearer Token (ส่งใน Authorization)',
  apikey: 'API Key (ส่งใน header)',
  basic: 'Basic Auth (user:pass)',
  none: 'ไม่ต้องยืนยันตัวตน',
}

export default async function StorefrontPage({
  searchParams,
}: {
  searchParams: Promise<{ provider?: string; game?: string }>
}) {
  await requireAdmin()
  const { provider: editProvider, game: editGame } = await searchParams

  const [providers, games, products, editingProvider, editingGame] = await Promise.all([
    q<Provider>(
      `select p.id, p.name, p.base_url, p.auth_type, (p.api_key is not null) as has_key,
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
          `select id, name, base_url, auth_type, (api_key is not null) as has_key,
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

      <div className="mb-6 rounded-xl border border-brand-500/30 bg-brand-500/10 px-4 py-3 text-xs leading-relaxed text-brand-400">
        <b>สถานะ:</b> ส่วนจัดการข้อมูลพร้อมใช้แล้ว — ตั้งค่าเกม รูป ราคา แพ็กเกจ
        และผูกผู้ให้บริการ API ได้เลย ส่วนหน้าเว็บที่ลูกค้าเข้ามากดซื้อเอง
        กับการยิงคำสั่งเติมไปยัง API จริง ยังไม่ได้เปิดใช้งาน
        รอข้อมูลผู้ให้บริการที่ร้านสมัครไว้ก่อน
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

          <ActionForm
            key={editingProvider?.id ?? 'new'}
            action={saveProviderAction}
            className="space-y-4"
            resetOnSuccess={!editingProvider}
          >
            {editingProvider ? (
              <input type="hidden" name="id" value={editingProvider.id} />
            ) : null}
            <div>
              <label className="label" htmlFor="name">
                ชื่อผู้ให้บริการ
              </label>
              <input
                id="name"
                name="name"
                className="input"
                defaultValue={editingProvider?.name ?? ''}
                placeholder="เช่น TopupHub, GameStore API"
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="base_url">
                ที่อยู่ API
              </label>
              <input
                id="base_url"
                name="base_url"
                className="input"
                defaultValue={editingProvider?.base_url ?? ''}
                placeholder="https://api.example.com/v1"
              />
            </div>
            <div>
              <label className="label" htmlFor="auth_type">
                วิธียืนยันตัวตน
              </label>
              <select
                id="auth_type"
                name="auth_type"
                className="input"
                defaultValue={editingProvider?.auth_type ?? 'bearer'}
              >
                {Object.entries(AUTH_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="api_key">
                คีย์ / โทเคน
              </label>
              <input
                id="api_key"
                name="api_key"
                type="password"
                className="input"
                autoComplete="new-password"
                placeholder={
                  editingProvider?.has_key ? 'มีคีย์อยู่แล้ว — เว้นว่างถ้าไม่เปลี่ยน' : 'วางคีย์ที่นี่'
                }
              />
              <p className="mt-1 text-xs text-mute">
                เก็บไว้ในฐานข้อมูลและใช้เฉพาะฝั่งเซิร์ฟเวอร์ ไม่ถูกส่งออกไปที่เบราว์เซอร์
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="priority">
                  ลำดับความสำคัญ
                </label>
                <input
                  id="priority"
                  name="priority"
                  type="number"
                  className="input"
                  defaultValue={editingProvider?.priority ?? 100}
                />
              </div>
              <div className="flex items-end pb-2">
                <label className="flex items-center gap-2 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    name="is_active"
                    defaultChecked={editingProvider ? editingProvider.is_active : true}
                    className="size-4 rounded border-ink-600 bg-ink-850"
                  />
                  เปิดใช้งาน
                </label>
              </div>
            </div>
            <div>
              <label className="label" htmlFor="note">
                หมายเหตุ
              </label>
              <input
                id="note"
                name="note"
                className="input"
                defaultValue={editingProvider?.note ?? ''}
                placeholder="เช่น ใช้กับเกมค่าย Garena"
              />
            </div>
            <SubmitButton className="btn-primary w-full">
              {editingProvider ? 'บันทึกการแก้ไข' : 'เพิ่มผู้ให้บริการ'}
            </SubmitButton>
          </ActionForm>
        </div>

        <div className="card">
          <SectionTitle
            right={<span className="text-xs text-mute">{num(providers.length)} เจ้า</span>}
          >
            ผู้ให้บริการ API ที่ต่อไว้
          </SectionTitle>
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
                    <th>ยืนยันตัวตน</th>
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
                      <td className="text-xs text-slate-300">{p.auth_type}</td>
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
                  className="h-32 w-full rounded-lg border border-ink-700 object-cover"
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
                            className="size-10 rounded-lg border border-ink-700 object-cover"
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
    </>
  )
}
