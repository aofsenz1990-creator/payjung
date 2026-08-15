import Link from 'next/link'
import { notFound } from 'next/navigation'
import { q, q1 } from '@/lib/db'
import { getShopCustomer } from '@/lib/shop'
import { shopOrderAction } from '@/lib/actions/shop'
import { BuyForm, type BuyPackage } from '@/components/BuyForm'

export const dynamic = 'force-dynamic'

export default async function ShopGamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const gameId = Number(id)
  if (!Number.isFinite(gameId)) notFound()

  const [game, packages, customer] = await Promise.all([
    q1<{ id: number; name: string; image_url: string | null; description: string | null }>(
      'select id, name, image_url, description from games where id = $1 and is_published and is_active',
      [gameId]
    ),
    q<BuyPackage>(
      `select id, name, sell_price::float8 as sell_price, image_url, track_stock, stock_qty
         from products
        where game_id = $1 and is_published and is_active
        order by sort_order, sell_price`,
      [gameId]
    ),
    getShopCustomer(),
  ])

  if (!game) notFound()

  return (
    <>
      <Link href="/shop" className="text-sm text-brand-400 hover:underline">
        ← กลับหน้าแรก
      </Link>

      <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="size-28 shrink-0 overflow-hidden rounded-2xl border border-ink-700 bg-ink-850">
          {game.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={game.image_url} alt={game.name} className="size-full object-contain p-2" />
          ) : (
            <span className="flex size-full items-center justify-center text-4xl">🎮</span>
          )}
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">{game.name}</h1>
          {game.description ? (
            <p className="mt-1 text-sm leading-relaxed text-mute">{game.description}</p>
          ) : null}
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-ink-700 bg-ink-900 p-5">
        {packages.length === 0 ? (
          <p className="py-8 text-center text-sm text-mute">
            เกมนี้ยังไม่เปิดขายแพ็กเกจบนหน้าเว็บ กรุณาติดต่อร้านโดยตรง
          </p>
        ) : (
          <BuyForm
            action={shopOrderAction}
            packages={packages}
            credit={customer?.credit ?? 0}
            signedIn={Boolean(customer)}
            defaultGameUid={customer?.game_uid}
          />
        )}
      </div>

      <p className="mt-4 text-xs leading-relaxed text-mute">
        เมื่อกดสั่งซื้อ ระบบจะตัดเครดิตทันทีและส่งคำสั่งให้ทางร้านดำเนินการเติมให้
        ตรวจสอบสถานะได้ที่หน้า{' '}
        <Link href="/shop/me" className="text-brand-400 underline">
          บัญชีของฉัน
        </Link>
      </p>
    </>
  )
}
