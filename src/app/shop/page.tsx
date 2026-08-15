import Link from 'next/link'
import { q } from '@/lib/db'
import { getSiteSettings } from '@/lib/shop'
import { dateOnly, money, num } from '@/lib/format'

export const dynamic = 'force-dynamic'

type ShopGame = {
  id: number
  name: string
  image_url: string | null
  description: string | null
  packages: number
  min_price: number | null
}

export default async function ShopHome({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q: keyword } = await searchParams
  const search = (keyword ?? '').trim()
  const settings = await getSiteSettings()

  const [games, news] = await Promise.all([
    q<ShopGame>(
      `select g.id, g.name, g.image_url, g.description,
              (select count(*) from products p
                where p.game_id = g.id and p.is_published and p.is_active)::int as packages,
              (select min(p.sell_price)::float8 from products p
                where p.game_id = g.id and p.is_published and p.is_active) as min_price
         from games g
        where g.is_published and g.is_active
          ${search ? 'and (g.name ilike $1 or g.publisher ilike $1 or g.description ilike $1)' : ''}
        order by g.sort_order, g.name`,
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
      <section className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-white sm:text-3xl">เติมเกมกับ Pay Jung</h1>
        <p className="mt-2 text-sm text-mute">
          {settings.shop_tagline ?? 'เลือกเกมที่ต้องการเติม แล้วใช้เครดิตในบัญชีของคุณได้เลย'}
        </p>

        <form method="get" className="mx-auto mt-5 flex max-w-md gap-2">
          <input
            name="q"
            defaultValue={search}
            className="input"
            placeholder="ค้นหาเกม เช่น Free Fire, RoV"
            aria-label="ค้นหาเกม"
          />
          <button type="submit" className="btn-primary">
            ค้นหา
          </button>
        </form>
      </section>

      <section className="mb-10">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-white">
            {search ? `ผลการค้นหา "${search}"` : 'เกมทั้งหมด'}
          </h2>
          <span className="text-xs text-mute">{num(games.length)} เกม</span>
        </div>

        {games.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink-700 px-4 py-12 text-center text-sm text-mute">
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
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {games.map((g) => (
              <Link
                key={g.id}
                href={`/shop/game/${g.id}`}
                className="group overflow-hidden rounded-2xl border border-ink-700 bg-ink-900 transition hover:border-brand-500/60 hover:shadow-lg hover:shadow-brand-600/10"
              >
                <div className="aspect-square overflow-hidden bg-ink-850">
                  {g.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={g.image_url}
                      alt={g.name}
                      className="size-full object-contain p-3 transition group-hover:scale-105"
                    />
                  ) : (
                    <span className="flex size-full items-center justify-center text-4xl">🎮</span>
                  )}
                </div>
                <div className="p-3">
                  <p className="truncate font-medium text-white">{g.name}</p>
                  <p className="mt-1 text-xs text-mute">
                    {g.packages > 0 ? (
                      <>
                        {num(g.packages)} แพ็กเกจ · เริ่ม{' '}
                        <span className="text-brand-400">{money(g.min_price ?? 0)}</span> บาท
                      </>
                    ) : (
                      'ยังไม่มีแพ็กเกจ'
                    )}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* ข่าวสารด้านล่างเว็บ */}
      {news.length > 0 ? (
        <section>
          <h2 className="mb-4 text-lg font-semibold text-white">ข่าวสารและโปรโมชั่น</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {news.map((n) => {
              const card = (
                <article className="h-full overflow-hidden rounded-2xl border border-ink-700 bg-ink-900">
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
                      <h3 className="font-medium text-white">{n.title}</h3>
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
