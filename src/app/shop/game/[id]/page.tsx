import Link from 'next/link'
import { notFound } from 'next/navigation'
import { q, q1 } from '@/lib/db'
import { getShopCustomer } from '@/lib/shop'
import { jsonArray } from '@/lib/json'
import { shopOrderAction } from '@/lib/actions/shop'
import { BuyForm, type BuyField, type BuyPackage } from '@/components/BuyForm'

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
    q<Omit<BuyPackage, 'fields'> & { provider_fields: unknown; provider_variant: string | null }>(
      `select id, name, sell_price::float8 as sell_price, image_url, track_stock, stock_qty,
              provider_fields, provider_variant
         from products
        where game_id = $1 and is_published and is_active
        order by provider_variant nulls first, sort_order, sell_price`,
      [gameId]
    ),
    getShopCustomer(),
  ])

  if (!game) notFound()

  // ช่องที่ต้องกรอกติดมากับแพ็กเกจ เพราะเกมเดียวกันคนละประเภท (THB / MYR / GOC)
  // ใช้ข้อมูลคนละชุด บางอันขอ UID บางอันขอลิงก์ บางอันขอ AID
  const buyPackages: BuyPackage[] = packages.map((p) => ({
    id: p.id,
    name: p.name,
    sell_price: p.sell_price,
    image_url: p.image_url,
    track_stock: p.track_stock,
    stock_qty: p.stock_qty,
    variant: p.provider_variant,
    fields: jsonArray<BuyField>(p.provider_fields),
  }))

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/shop" className="text-sm text-brand-400 hover:underline">
        ← กลับหน้าแรก
      </Link>

      <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="size-28 shrink-0 overflow-hidden rounded-2xl border border-ink-700/70 bg-ink-850/70 backdrop-blur-sm">
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

      <div className="mt-6 rounded-2xl border border-ink-700/70 bg-ink-900/75 p-5 backdrop-blur-md">
        {packages.length === 0 ? (
          <p className="py-8 text-center text-sm text-mute">
            เกมนี้ยังไม่เปิดขายแพ็กเกจบนหน้าเว็บ กรุณาติดต่อร้านโดยตรง
          </p>
        ) : (
          <BuyForm
            action={shopOrderAction}
            packages={buyPackages}
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
    </div>
  )
}
