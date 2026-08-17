import Link from 'next/link'
import { q } from '@/lib/db'
import { getShopCustomer, getSiteSettings, isPartner, priceExpr } from '@/lib/shop'
import { dateOnly, money, num } from '@/lib/format'
import { WhyUs } from '@/components/WhyUs'

export const dynamic = 'force-dynamic'

type ShopGame = {
  id: number
  name: string
  image_url: string | null
  description: string | null
  packages: number
  min_price: number | null
  recent_sales: number
}

export default async function ShopHome({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q: keyword } = await searchParams
  const search = (keyword ?? '').trim()
  const settings = await getSiteSettings()

  // ราคาเริ่มต้นที่โชว์บนการ์ดต้องเป็นราคาที่ลูกค้าคนนี้จ่ายจริง
  // ไม่งั้นพาร์ทเนอร์เห็นราคาทั่วไปที่หน้าแรก แล้วไปเจออีกราคาตอนกดเข้าเกม
  const partner = isPartner(await getShopCustomer())

  const [games, news] = await Promise.all([
    q<ShopGame>(
      // เรียงตามกระแส: เกมที่ปักหมุดไว้ขึ้นก่อน จากนั้นเรียงตามยอดขาย 30 วันล่าสุด
      // เกมที่ยังไม่มีใครซื้อจะไปอยู่ท้าย ๆ แล้วเรียงตามชื่อกันเอง
      // (ปักหมุด = ตั้ง sort_order ให้น้อยกว่าค่าเริ่มต้น 100)
      `select g.id, g.name, g.image_url, g.description,
              (select count(*) from products p
                where p.game_id = g.id and p.is_published and p.is_active)::int as packages,
              (select min(${priceExpr(partner)})::float8 from products p
                where p.game_id = g.id and p.is_published and p.is_active) as min_price,
              (select count(*) from sales s
                where s.game_id = g.id and s.status = 'paid'
                  and s.sold_at >= now() - interval '30 days')::int as recent_sales
         from games g
        where g.is_published and g.is_active
          ${search ? 'and (g.name ilike $1 or g.publisher ilike $1 or g.description ilike $1)' : ''}
        order by g.sort_order, recent_sales desc, g.name`,
      search ? [`%${search}%`] : []
    ),
    q<{
      id: number
      title: string
      body: string | null
      image_url: string | null
      link_url: string | null
      created_at: string
      pinned: boolean
    }>(
      `select id, title, body, image_url, link_url, created_at, pinned
         from news where is_published
        order by pinned desc, created_at desc limit 6`
    ),
  ])

  return (
    <>
      {/* ส่วนหัว — ดวงไฟเบลอสองดวงวางซ้อนกันคนละสี ทำให้พื้นหลังมีมิติโดยไม่รบกวนตัวหนังสือ */}
      <section className="relative mb-10 text-center">
        <div
          aria-hidden
          className="glow-orb -top-16 left-1/4 size-56 bg-brand-500/25"
        />
        <div
          aria-hidden
          className="glow-orb -top-10 right-1/4 size-56 bg-aqua-500/20"
        />

        <div className="relative">
          <h1 className="neon-title text-3xl font-extrabold tracking-tight sm:text-5xl">
            เติมเกมกับ Pay Jung
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-mute sm:text-base">
            {settings.shop_tagline ?? 'เลือกเกมที่ต้องการเติม แล้วใช้เครดิตในบัญชีของคุณได้เลย'}
          </p>

          {/* จุดขายสามข้อ บอกให้ลูกค้าใหม่รู้ว่าร้านนี้ต่างจากร้านอื่นยังไง */}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs">
            <span className="chip bg-brand-500/15 text-brand-400 ring-1 ring-brand-500/25">
              ⚡ เติมอัตโนมัติ
            </span>
            <span className="chip bg-aqua-500/15 text-aqua-400 ring-1 ring-aqua-500/25">
              🕐 เปิด 24 ชม.
            </span>
            <span className="chip bg-grape-500/15 text-grape-400 ring-1 ring-grape-500/25">
              💎 ราคาพิเศษสำหรับพาร์ทเนอร์
            </span>
          </div>

          <form method="get" className="mx-auto mt-6 flex max-w-lg gap-2">
            <input
              name="q"
              defaultValue={search}
              className="input rounded-full px-5 py-2.5"
              placeholder="ค้นหาเกม เช่น Free Fire, RoV"
              aria-label="ค้นหาเกม"
            />
            <button type="submit" className="btn-primary rounded-full px-6">
              ค้นหา
            </button>
          </form>
        </div>
      </section>

      {/* scroll-mt กันหัวข้อถูกแถบเมนูด้านบนบังตอนกดลิงก์ "เกม" */}
      <section id="games" className="mb-10 scroll-mt-24">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-fg">
            {/* แถบไล่สีเล็ก ๆ หน้าหัวข้อ ทำให้สายตาจับจุดเริ่มต้นของแต่ละส่วนได้ทันที */}
            <span
              aria-hidden
              className="h-5 w-1 rounded-full bg-linear-to-b from-brand-400 to-grape-500"
            />
            {search ? `ผลการค้นหา "${search}"` : 'เกมทั้งหมด'}
          </h2>
          <span className="chip bg-ink-800 text-mute">{num(games.length)} เกม</span>
        </div>

        {games.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink-700/70 bg-ink-900/40 px-4 py-12 text-center text-sm text-mute backdrop-blur-sm">
            {search ? (
              <>
                ไม่พบเกมที่ค้นหา —{' '}
                <Link href="/shop" className="text-brand-400 underline">
                  ดูเกมทั้งหมด
                </Link>
              </>
            ) : (
              'ยังไม่มีเกมเปิดขายบนหน้าเว็บ'
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
            {games.map((g) => (
              <Link key={g.id} href={`/shop/game/${g.id}`} className="group game-card">
                <div className="relative aspect-square overflow-hidden bg-ink-850/60">
                  {g.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={g.image_url}
                      alt={g.name}
                      className="size-full object-contain p-2 transition duration-300 group-hover:scale-110"
                    />
                  ) : (
                    <span className="flex size-full items-center justify-center text-4xl">🎮</span>
                  )}
                  {/* ไล่สีทับขอบล่างของรูป ให้รูปกลืนเข้ากับส่วนที่เป็นตัวหนังสือ
                      ไม่งั้นรูปพื้นสว่างจะตัดกับการ์ดพื้นเข้มเป็นเส้นแข็ง ๆ */}
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-linear-to-t from-ink-950/90 to-transparent"
                  />
                </div>
                <div className="p-2.5">
                  <p className="truncate text-sm font-medium text-fg transition group-hover:text-brand-400">
                    {g.name}
                  </p>
                  {g.packages > 0 ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="price-tag">เริ่ม {money(g.min_price ?? 0)}฿</span>
                      <span className="text-[11px] text-mute">{num(g.packages)} แพ็ก</span>
                    </div>
                  ) : (
                    <p className="mt-1.5 text-[11px] leading-4 text-mute">ยังไม่มีแพ็กเกจ</p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* จุดขายของร้าน — วางไว้ใต้รายการเกม เพราะคนที่เลื่อนมาถึงตรงนี้คือคนที่ยังลังเล
          ส่วนคนที่รู้อยู่แล้วว่าจะเติมเกมอะไรก็กดจากด้านบนไปเลยไม่ต้องอ่าน */}
      <WhyUs />

      {/* ข่าวสารด้านล่างเว็บ */}
      {news.length > 0 ? (
        <section>
          <h2 className="mb-4 text-lg font-semibold text-fg">ข่าวสารและโปรโมชั่น</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {news.map((n) => {
              const card = (
                <article className="h-full overflow-hidden rounded-2xl border border-ink-700/70 bg-ink-900/70 backdrop-blur-sm">
                  {n.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={n.image_url}
                      alt={n.title}
                      className="h-36 w-full object-cover"
                    />
                  ) : null}
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-medium text-fg">{n.title}</h3>
                      {n.pinned ? (
                        <span className="chip shrink-0 bg-brand-500/15 text-brand-400">ปักหมุด</span>
                      ) : null}
                    </div>
                    {n.body ? (
                      <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-mute">
                        {n.body}
                      </p>
                    ) : null}
                    <p className="mt-3 text-xs text-mute">{dateOnly(n.created_at)}</p>
                  </div>
                </article>
              )
              return n.link_url ? (
                <a key={n.id} href={n.link_url} target="_blank" rel="noreferrer">
                  {card}
                </a>
              ) : (
                <div key={n.id}>{card}</div>
              )
            })}
          </div>
        </section>
      ) : null}
    </>
  )
}
