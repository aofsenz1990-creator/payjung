import Link from 'next/link'
import { notFound } from 'next/navigation'
import { q, q1 } from '@/lib/db'
import { getShopCustomer, getSiteSettings, isPartner, priceExpr } from '@/lib/shop'
import { jsonArray } from '@/lib/json'
import { orderFieldSpec } from '@/lib/orderField'
import { shopOrderAction } from '@/lib/actions/shop'
import { BuyForm, type BuyField, type BuyPackage } from '@/components/BuyForm'

export const dynamic = 'force-dynamic'

export default async function ShopGamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const gameId = Number(id)
  if (!Number.isFinite(gameId)) notFound()

  // ต้องรู้ก่อนว่าใครกำลังดูอยู่ เพราะราคาที่ดึงมาขึ้นกับระดับของลูกค้า
  const customer = await getShopCustomer()
  const partner = isPartner(customer)

  const [settings, game, packages] = await Promise.all([
    // คำแนะนำวิธีเอาลิงก์ของแต่ละค่าย ร้านตั้งเองได้ในหน้าจัดการเว็บไซต์
    getSiteSettings(),
    q1<{
      id: number
      name: string
      image_url: string | null
      description: string | null
      order_field: string | null
      provider_fields: unknown
    }>(
      `select id, name, image_url, description, order_field, provider_fields
         from games where id = $1 and is_published and is_active`,
      [gameId]
    ),
    q<Omit<BuyPackage, 'fields'> & { provider_fields: unknown; provider_variant: string | null }>(
      `select p.id, p.name, ${priceExpr(partner)}::float8 as sell_price, p.image_url,
              p.track_stock, p.stock_qty, p.provider_fields, p.provider_variant
         from products p
        where p.game_id = $1 and p.is_published and p.is_active
        order by p.provider_variant nulls first, p.sort_order, sell_price`,
      [gameId]
    ),
  ])

  if (!game) notFound()

  // ช่องที่ต้องกรอกติดมากับแพ็กเกจ เพราะเกมเดียวกันคนละประเภท (THB / MYR / GOC)
  // ใช้ข้อมูลคนละชุด บางอันขอ UID บางอันขอลิงก์ บางอันขอ AID
  // ช่องกรอกที่ร้านตั้งเองรายเกม — ใช้ตอนผู้ให้บริการไม่ได้บอกมา
  // หรือบอกมาไม่ตรงกับที่หน้าเว็บของเขาขอจริง (เช่นต้องกรอก Role ID + เลือกเซิร์ฟเวอร์)
  const gameFields = jsonArray<BuyField>(game.provider_fields)

  const buyPackages: BuyPackage[] = packages.map((p) => ({
    id: p.id,
    name: p.name,
    sell_price: p.sell_price,
    image_url: p.image_url,
    track_stock: p.track_stock,
    stock_qty: p.stock_qty,
    variant: p.provider_variant,
    // ของร้านมาก่อนเสมอ ถ้าไม่ได้ตั้งไว้ค่อยใช้ของผู้ให้บริการ
    fields: gameFields ?? jsonArray<BuyField>(p.provider_fields),
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
          <h1 className="text-2xl font-bold text-fg">{game.name}</h1>
          {game.description ? (
            <p className="mt-1 text-sm leading-relaxed text-mute">{game.description}</p>
          ) : null}
          {/* บอกให้พาร์ทเนอร์รู้ว่าราคาที่เห็นคือราคาพิเศษแล้ว ไม่ต้องทักมาถามร้าน */}
          {partner ? (
            <span className="chip mt-2 inline-block bg-grape-600/20 text-grape-400">
              🤝 ราคาพาร์ทเนอร์
            </span>
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
            orderField={orderFieldSpec(game.order_field)}
            linkHints={{
              oneone: settings.link_hint_oneone ?? null,
              goc: settings.link_hint_goc ?? null,
              razer: settings.link_hint_razer ?? null,
              fallback: settings.link_hint_default ?? null,
            }}
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
