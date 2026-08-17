import { q } from '@/lib/db'
import { requirePage } from '@/lib/auth'
import { getSiteSettings, pointsPerBaht } from '@/lib/shop'
import { createCreditCodesAction, deleteCreditCodeAction } from '@/lib/actions/creditCodes'
import { ActionForm, ConfirmButton, SubmitButton } from '@/components/ActionForm'
import { CodeList } from '@/components/CodeList'
import { Empty, PageHeader, SectionTitle } from '@/components/ui'
import { dateTime, money, num } from '@/lib/format'

export const dynamic = 'force-dynamic'

type CodeRow = {
  id: number
  code: string
  points: number
  note: string | null
  batch: string | null
  redeemed_at: string | null
  customer_name: string | null
  created_at: string
}

export default async function CreditCodesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>
}) {
  await requirePage('credit-codes')
  const { q: keyword, status } = await searchParams
  const search = (keyword ?? '').trim()
  const onlyUnused = status === 'unused'
  const onlyUsed = status === 'used'

  const where: string[] = []
  const params: unknown[] = []
  if (search) {
    params.push(`%${search}%`)
    where.push(`(c.code ilike $${params.length} or c.note ilike $${params.length})`)
  }
  if (onlyUnused) where.push('c.redeemed_by is null')
  if (onlyUsed) where.push('c.redeemed_by is not null')

  const [codes, summary, settings] = await Promise.all([
    q<CodeRow>(
      `select c.id, c.code, c.points::float8 as points, c.note, c.batch,
              c.redeemed_at, cu.name as customer_name, c.created_at
         from credit_codes c
         left join customers cu on cu.id = c.redeemed_by
        ${where.length ? `where ${where.join(' and ')}` : ''}
        order by c.created_at desc, c.id desc
        limit 300`,
      params
    ),
    q<{ total: number; used: number; unused_points: number; used_points: number }>(
      `select count(*)::int as total,
              count(*) filter (where redeemed_by is not null)::int as used,
              coalesce(sum(points) filter (where redeemed_by is null), 0)::float8 as unused_points,
              coalesce(sum(points) filter (where redeemed_by is not null), 0)::float8 as used_points
         from credit_codes`
    ),
    getSiteSettings(),
  ])

  const stat = summary[0] ?? { total: 0, used: 0, unused_points: 0, used_points: 0 }
  const rate = pointsPerBaht(settings)

  // โค้ดที่ยังไม่ถูกใช้ของการสร้างครั้งล่าสุด — ไว้ให้กดคัดลอกทั้งชุด
  const latestBatch = codes.find((c) => c.batch)?.batch ?? null
  const latestCodes = latestBatch
    ? codes.filter((c) => c.batch === latestBatch && !c.redeemed_at).map((c) => c.code)
    : []

  return (
    <>
      <PageHeader
        title="โค้ดเครดิต"
        subtitle={`สร้างโค้ดให้ลูกค้าไปแลกเป็นเครดิตบนหน้าเว็บ · ${num(rate)} เครดิต = 1 บาท`}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="card">
          <p className="text-xs font-medium text-mute">โค้ดทั้งหมด</p>
          <p className="mt-2 text-2xl font-bold text-white">{num(stat.total)}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-mute">ใช้ไปแล้ว</p>
          <p className="mt-2 text-2xl font-bold text-good">{num(stat.used)}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-mute">เครดิตที่ยังไม่ถูกแลก</p>
          <p className="mt-2 text-2xl font-bold text-warn">{num(stat.unused_points)}</p>
          <p className="mt-1 text-xs text-mute">คิดเป็น {money(stat.unused_points / rate)} บาท</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-mute">เครดิตที่แลกไปแล้ว</p>
          <p className="mt-2 text-2xl font-bold text-white">{num(stat.used_points)}</p>
          <p className="mt-1 text-xs text-mute">คิดเป็น {money(stat.used_points / rate)} บาท</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[24rem_1fr]">
        <div className="card h-fit">
          <SectionTitle>สร้างโค้ดชุดใหม่</SectionTitle>
          <ActionForm action={createCreditCodesAction} className="space-y-4" resetOnSuccess>
            <div>
              <label className="label" htmlFor="points">
                มูลค่าต่อใบ (เครดิต)
              </label>
              <input
                id="points"
                name="points"
                type="number"
                min={1}
                className="input"
                placeholder="เช่น 10000"
                required
              />
              <p className="mt-1 text-xs text-mute">
                {num(rate)} เครดิต = 1 บาท · ใส่ 10,000 = โค้ดใบละ {money(10000 / rate)} บาท
              </p>
            </div>
            <div>
              <label className="label" htmlFor="count">
                สร้างกี่ใบ
              </label>
              <input
                id="count"
                name="count"
                type="number"
                min={1}
                max={200}
                defaultValue={1}
                className="input"
                required
              />
              <p className="mt-1 text-xs text-mute">สร้างได้สูงสุด 200 ใบต่อครั้ง</p>
            </div>
            <div>
              <label className="label" htmlFor="prefix">
                คำนำหน้าโค้ด (ไม่ใส่ก็ได้)
              </label>
              <input
                id="prefix"
                name="prefix"
                className="input uppercase"
                placeholder="เช่น PROMO"
                maxLength={8}
              />
              <p className="mt-1 text-xs text-mute">ใช้แยกว่าโค้ดชุดนี้ทำไว้ทำอะไร</p>
            </div>
            <div>
              <label className="label" htmlFor="note">
                หมายเหตุ
              </label>
              <input id="note" name="note" className="input" placeholder="เช่น แจกงานอีเวนต์" />
            </div>
            <SubmitButton className="btn-primary w-full" pendingLabel="กำลังสร้าง...">
              สร้างโค้ด
            </SubmitButton>
          </ActionForm>

          {latestCodes.length > 0 ? (
            <div className="mt-4 border-t border-ink-700 pt-4">
              <p className="mb-2 text-xs font-medium text-mute">
                โค้ดที่ยังไม่ถูกใช้จากชุดล่าสุด ({num(latestCodes.length)} ใบ)
              </p>
              <CodeList codes={latestCodes} />
            </div>
          ) : null}
        </div>

        <div className="card">
          <SectionTitle right={<span className="text-xs text-mute">{num(codes.length)} รายการ</span>}>
            โค้ดทั้งหมด
          </SectionTitle>

          <form method="get" className="mb-4 flex flex-wrap gap-2">
            <input
              name="q"
              className="input flex-1"
              defaultValue={search}
              placeholder="ค้นหาโค้ดหรือหมายเหตุ"
            />
            <select name="status" className="input w-40" defaultValue={status ?? ''}>
              <option value="">ทั้งหมด</option>
              <option value="unused">ยังไม่ถูกใช้</option>
              <option value="used">ใช้แล้ว</option>
            </select>
            <button type="submit" className="btn-ghost">
              ค้นหา
            </button>
          </form>

          {codes.length === 0 ? (
            <Empty>ยังไม่มีโค้ด — สร้างชุดแรกจากฟอร์มด้านซ้าย</Empty>
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>โค้ด</th>
                    <th className="text-right">เครดิต</th>
                    <th>สถานะ</th>
                    <th>ผู้ใช้ / เวลา</th>
                    <th>หมายเหตุ</th>
                    <th className="text-right">จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {codes.map((c) => (
                    <tr key={c.id}>
                      <td className="font-mono text-xs text-slate-100 select-all">{c.code}</td>
                      <td className="text-right font-medium text-white">{num(c.points)}</td>
                      <td>
                        {c.redeemed_at ? (
                          <span className="chip bg-ink-700/60 text-mute">ใช้แล้ว</span>
                        ) : (
                          <span className="chip bg-good/15 text-good">พร้อมใช้</span>
                        )}
                      </td>
                      <td className="text-xs text-mute">
                        {c.customer_name ? (
                          <>
                            <span className="block text-slate-300">{c.customer_name}</span>
                            <span className="block">{dateTime(c.redeemed_at!)}</span>
                          </>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="text-xs text-mute">{c.note ?? '-'}</td>
                      <td className="text-right">
                        {c.redeemed_at ? (
                          <span className="text-xs text-mute">ลบไม่ได้</span>
                        ) : (
                          <form action={deleteCreditCodeAction}>
                            <input type="hidden" name="id" value={c.id} />
                            <ConfirmButton message={`ลบโค้ด ${c.code}?`}>ลบ</ConfirmButton>
                          </form>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-3 text-xs leading-relaxed text-mute">
            โค้ดที่ถูกใช้ไปแล้วลบไม่ได้ เพราะเป็นหลักฐานว่าใครได้เครดิตไปเท่าไหร่ ·
            แสดงสูงสุด 300 รายการล่าสุด
          </p>
        </div>
      </div>
    </>
  )
}
