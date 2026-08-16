import Link from 'next/link'
import { q, q1 } from '@/lib/db'
import { requirePage } from '@/lib/auth'
import { deleteGameAction, saveGameAction } from '@/lib/actions/catalog'
import { money, num } from '@/lib/format'
import { ActionForm, ConfirmButton, SubmitButton } from '@/components/ActionForm'
import { ImageInput } from '@/components/ImageInput'
import { Badge, Empty, PageHeader, SectionTitle } from '@/components/ui'

export const dynamic = 'force-dynamic'

// Server Action ของหน้านี้ต้องปรับโครงสร้างฐานข้อมูลตอน instance เย็นด้วย
// ถ้าฟังก์ชันถูกตัดก่อนจบ ปุ่มบันทึกจะหมุนค้างโดยไม่มี error ให้เห็น
export const maxDuration = 60

type GameRow = {
  id: number
  name: string
  publisher: string | null
  note: string | null
  is_active: boolean
  image_url: string | null
  products: number
  stock: number
  month_revenue: number
}

export default async function GamesPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; q?: string }>
}) {
  const user = await requirePage('games')
  const isAdmin = user.role === 'admin'
  const { edit, q: keyword } = await searchParams
  const search = (keyword ?? '').trim()

  const [games, editing] = await Promise.all([
    q<GameRow>(
      `select g.id, g.name, g.publisher, g.note, g.is_active, g.image_url,
              (select count(*) from products p where p.game_id = g.id)::int as products,
              coalesce((select sum(p.stock_qty) from products p
                         where p.game_id = g.id and p.track_stock), 0)::int as stock,
              coalesce((select sum(s.total) from sales s
                         where s.game_id = g.id and s.status = 'paid'
                           and (s.sold_at at time zone 'Asia/Bangkok')::date
                               >= date_trunc('month', (now() at time zone 'Asia/Bangkok')::date)
                       ), 0)::float8 as month_revenue
         from games g
        ${search ? 'where g.name ilike $1 or g.publisher ilike $1 or g.note ilike $1' : ''}
        order by g.is_active desc, g.name`,
      search ? [`%${search}%`] : []
    ),
    edit
      ? q1<GameRow>('select id, name, publisher, note, is_active, image_url from games where id = $1', [
          Number(edit),
        ])
      : Promise.resolve(null),
  ])

  return (
    <>
      <PageHeader
        title="รายชื่อเกมที่ขาย"
        subtitle="จัดการเกมและแพ็กเกจเติมของแต่ละเกม (กดที่ชื่อเกมเพื่อดูแพ็กเกจ)"
      />

      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <div className="card h-fit">
          <SectionTitle
            right={
              editing ? (
                <Link href="/games" className="text-xs text-brand-400">
                  ยกเลิกการแก้ไข
                </Link>
              ) : undefined
            }
          >
            {editing ? `แก้ไข: ${editing.name}` : 'เพิ่มเกมใหม่'}
          </SectionTitle>

          <ActionForm
            key={editing?.id ?? 'new'}
            action={saveGameAction}
            className="space-y-4"
            resetOnSuccess={!editing}
          >
            {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
            <div>
              <label className="label" htmlFor="name">
                ชื่อเกม
              </label>
              <input
                id="name"
                name="name"
                className="input"
                defaultValue={editing?.name ?? ''}
                placeholder="เช่น Free Fire"
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="publisher">
                ผู้ให้บริการ
              </label>
              <input
                id="publisher"
                name="publisher"
                className="input"
                defaultValue={editing?.publisher ?? ''}
                placeholder="เช่น Garena"
              />
            </div>
            <div>
              <label className="label" htmlFor="note">
                หมายเหตุ
              </label>
              <input
                id="note"
                name="note"
                className="input"
                defaultValue={editing?.note ?? ''}
                placeholder="เช่น ต้องใช้ Player ID"
              />
            </div>
            <ImageInput
              currentUrl={editing?.image_url}
              label="รูปเกม"
              hint="ใช้แสดงบนหน้าเว็บลูกค้า — คลิกกรอบเพื่อเลือกไฟล์ ลากรูปมาวาง หรือกด Ctrl+V"
            />
            <label className="flex items-center gap-2 text-sm text-slate-200">
              <input
                type="checkbox"
                name="is_active"
                defaultChecked={editing ? editing.is_active : true}
                className="size-4 rounded border-ink-600 bg-ink-850"
              />
              เปิดขายอยู่
            </label>
            <SubmitButton className="btn-primary w-full">
              {editing ? 'บันทึกการแก้ไข' : 'เพิ่มเกม'}
            </SubmitButton>
          </ActionForm>
        </div>

        <div className="card">
          <SectionTitle right={<span className="text-xs text-mute">{num(games.length)} เกม</span>}>
            {search ? `ผลการค้นหา "${search}"` : 'เกมทั้งหมด'}
          </SectionTitle>

          <form method="get" className="mb-4 flex gap-2">
            <input
              name="q"
              className="input"
              defaultValue={search}
              placeholder="ค้นหาชื่อเกม ผู้ให้บริการ หรือหมายเหตุ"
              aria-label="ค้นหาเกม"
            />
            <button type="submit" className="btn-ghost">
              ค้นหา
            </button>
            {search ? (
              <Link href="/games" className="btn-ghost">
                ล้าง
              </Link>
            ) : null}
          </form>
          {games.length === 0 ? (
            <Empty>
              {search ? (
                <>
                  ไม่พบเกมที่ค้นหา —{' '}
                  <Link href="/games" className="text-brand-400 underline">
                    ดูเกมทั้งหมด
                  </Link>
                </>
              ) : (
                'ยังไม่มีเกมในระบบ เพิ่มเกมแรกจากฟอร์มด้านซ้าย'
              )}
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>รูป</th>
                    <th>เกม</th>
                    <th>ผู้ให้บริการ</th>
                    <th className="text-right">แพ็กเกจ</th>
                    <th className="text-right">สต๊อกรวม</th>
                    <th className="text-right">ยอดขายเดือนนี้</th>
                    <th>สถานะ</th>
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
                            —
                          </span>
                        )}
                      </td>
                      <td>
                        <Link
                          href={`/games/${g.id}`}
                          className="font-medium text-white hover:text-brand-400"
                        >
                          {g.name}
                        </Link>
                        {g.note ? (
                          <span className="block text-xs text-mute">{g.note}</span>
                        ) : null}
                      </td>
                      <td className="text-slate-300">{g.publisher ?? '-'}</td>
                      <td className="text-right">{num(g.products)}</td>
                      <td className="text-right">{num(g.stock)}</td>
                      <td className="text-right font-medium text-white">
                        {money(g.month_revenue)}
                      </td>
                      <td>
                        {g.is_active ? (
                          <Badge tone="good">เปิดขาย</Badge>
                        ) : (
                          <Badge>ปิดขาย</Badge>
                        )}
                      </td>
                      <td>
                        <div className="flex justify-end gap-1.5">
                          <Link href={`/games/${g.id}`} className="btn-ghost btn-sm">
                            แพ็กเกจ
                          </Link>
                          <Link href={`/games?edit=${g.id}`} className="btn-ghost btn-sm">
                            แก้ไข
                          </Link>
                          {isAdmin ? (
                            <form action={deleteGameAction}>
                              <input type="hidden" name="id" value={g.id} />
                              <ConfirmButton
                                message={`ลบเกม "${g.name}" และแพ็กเกจทั้งหมดของเกมนี้? (บิลขายเก่ายังอยู่ครบ)`}
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
        </div>
      </div>
    </>
  )
}
