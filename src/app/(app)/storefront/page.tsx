import Link from 'next/link'
import { q, q1 } from '@/lib/db'
import { jsonArray } from '@/lib/json'
import { requireAdmin } from '@/lib/auth'
import {
  deleteProviderAction,
  saveGameStorefrontAction,
  saveProviderAction,
  toggleGamePublishedAction,
  togglePinGameAction,
  setAllProductsPublishedAction,
  testProviderAction,
  toggleProductPublishedAction,
} from '@/lib/actions/storefront'
import { deleteNewsAction, saveNewsAction, saveSiteSettingsAction } from '@/lib/actions/shop'
import {
  refreshBalanceAction,
  setLowBalanceAction,
  toggleAutoDispatchAction,
} from '@/lib/actions/dispatch'
import { autoDispatchOn } from '@/lib/dispatch'
import { providerMeta } from '@/lib/providers/constants'
import { DEFAULT_SHOP_BG, DEFAULT_SHOP_COVER, getSiteSettings, SITE_KEYS } from '@/lib/shop'
import { ImageInput } from '@/components/ImageInput'
import { ProviderForm } from '@/components/ProviderForm'
import {
  importGamesAction,
  refreshImportedAction,
  syncCatalogAction,
} from '@/lib/actions/catalogSync'
import { dateOnly, money, num, todayISO } from '@/lib/format'
import { ActionForm, ConfirmButton, SubmitButton } from '@/components/ActionForm'
import { Badge, Empty, PageHeader, SectionTitle } from '@/components/ui'
import { LineNotifyPanel } from '@/components/LineNotifyPanel'
import { ProviderTopupPanel, type ProviderTopupRow } from '@/components/ProviderTopupPanel'
import { ORDER_FIELDS } from '@/lib/orderField'
import { headers } from 'next/headers'

export const dynamic = 'force-dynamic'

// การดึงรายการสินค้าจากผู้ให้บริการเป็น Server Action ของหน้านี้
// ผู้ให้บริการบางเจ้ามีสินค้าหลายพันรายการ ยิงถามแล้วเขียนลงฐานข้อมูลกินเวลาเกินค่าเริ่มต้น
// ถ้าไม่ยืดเวลาไว้ ฟังก์ชันจะถูกตัดกลางคันแล้วขึ้นค้างที่ปุ่ม "กำลังดึง..."
export const maxDuration = 60

type Provider = {
  id: number
  name: string
  kind: string
  base_url: string | null
  auth_type: string
  has_key: boolean
  username: string | null
  note: string | null
  priority: number
  is_active: boolean
  products: number
  balance: number | null
  balance_at: string | Date | null
  low_balance: number
  sandbox: boolean
}

type GameRow = {
  id: number
  name: string
  image_url: string | null
  description: string | null
  is_published: boolean
  sort_order: number
  order_field: string | null
  recent_sales: number
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
  /** ช่องที่ผู้ให้บริการบังคับให้ลูกค้ากรอก — ว่าง = หน้าเว็บจะถามแค่ไอดีเกมช่องเดียว */
  provider_fields: unknown
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

/** ผู้ให้บริการที่มีรายการสินค้าดึงเก็บไว้แล้ว — ใช้ทำแถบเลือกว่าจะดูของเจ้าไหน */
type CatalogProvider = {
  provider_id: number
  provider_name: string
  games: number
  packs: number
  synced_at: string
}

/** ราคาเริ่มต้นของเกมหนึ่ง ที่ผู้ให้บริการเจ้าหนึ่ง — ใช้เทียบกันว่าเจ้าไหนถูกกว่า */
type CatalogPrice = {
  provider_id: number
  provider_name: string
  game_name: string
  min_price: number
}

/**
 * กุญแจจับคู่ชื่อเกมข้ามผู้ให้บริการ
 * แต่ละเจ้าเขียนชื่อไม่เหมือนกันเป๊ะ (ตัวพิมพ์ใหญ่เล็ก เว้นวรรค ขีด วงเล็บ)
 * ตัดทุกอย่างที่ไม่ใช่ตัวอักษรหรือตัวเลขออก เหลือแต่แก่นชื่อไว้เทียบกัน
 * ชื่อที่ต่างกันจริง ๆ เช่น "Free Fire" กับ "Free Fire TH" จะยังถือเป็นคนละเกม ซึ่งถูกแล้ว
 */
function gameKey(name: string) {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
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

/** แท็บของหน้าจัดการเว็บไซต์ — เรียงตามที่ใช้บ่อยจากซ้ายไปขวา */
const TABS = [
  { key: 'games', label: '🎮 เกมบนหน้าเว็บ' },
  { key: 'products', label: '📦 แพ็กเกจ & การผูก API' },
  { key: 'catalog', label: '⬇️ ดึงรายการสินค้า' },
  { key: 'providers', label: '🔌 ผู้ให้บริการ API' },
  { key: 'topups', label: '💵 เติมเงินให้ผู้ให้บริการ' },
  { key: 'line', label: '🔔 แจ้งเตือน LINE' },
  { key: 'site', label: '⚙️ ตั้งค่าหน้าเว็บ & ข่าวสาร' },
] as const

const AUTH_LABELS: Record<string, string> = {
  bearer: 'Bearer Token (ส่งใน Authorization)',
  apikey: 'API Key (ส่งใน header)',
  basic: 'Basic Auth (user:pass)',
  none: 'ไม่ต้องยืนยันตัวตน',
}

export default async function StorefrontPage({
  searchParams,
}: {
  searchParams: Promise<{
    provider?: string
    game?: string
    cq?: string
    cp?: string
    pq?: string
    tab?: string
  }>
}) {
  await requireAdmin()
  const {
    provider: editProvider,
    game: editGame,
    cq,
    cp,
    pq,
    tab: tabParam,
  } = await searchParams

  // หน้านี้ยาวมาก แบ่งเป็นแท็บให้เลือกดูทีละส่วน
  // ถ้ากำลังแก้ไขอะไรอยู่ ให้เด้งไปแท็บนั้นเอง ไม่งั้นกดแก้ไขแล้วจะหาฟอร์มไม่เจอ
  const tab = editProvider
    ? 'providers'
    : editGame
      ? 'games'
      : pq
        ? 'products'
        : cq || cp
        ? 'catalog'
        : TABS.some((t) => t.key === tabParam)
          ? (tabParam as string)
          : 'games'
  const catalogSearch = (cq ?? '').trim()

  // ผู้ให้บริการที่มีรายการดึงไว้แล้ว — ต้องรู้ก่อนถึงจะเลือกได้ว่าจะแสดงรายการของเจ้าไหน
  // (ยิงก่อนชุดใหญ่หนึ่งครั้ง เฉพาะตอนเปิดแท็บนี้ แท็บอื่นไม่เสียเวลา)
  const catalogProviders =
    tab === 'catalog'
      ? await q<CatalogProvider>(
          `select c.provider_id, ap.name as provider_name,
                  count(distinct c.game_id)::int as games,
                  count(*)::int as packs,
                  max(c.synced_at) as synced_at
             from provider_catalog c
             join api_providers ap on ap.id = c.provider_id
            group by c.provider_id, ap.name
            order by ap.name`
        )
      : []

  // เลือกดูทีละเจ้าเสมอ — เดิมแสดงรวมกันทุกเจ้า ทำให้เทียบราคายาก
  // และปุ่มนำเข้าจะยิงเข้าเจ้าของแถวแรกเจ้าเดียว ซึ่งผิดถ้ามีหลายเจ้าปนกัน
  const catalogProviderId =
    catalogProviders.find((p) => String(p.provider_id) === cp)?.provider_id ??
    catalogProviders[0]?.provider_id ??
    null
  const catalogProvider = catalogProviders.find((p) => p.provider_id === catalogProviderId) ?? null

  const catalogParams: unknown[] = []
  const catalogWhere: string[] = []
  if (catalogProviderId !== null) {
    catalogParams.push(catalogProviderId)
    catalogWhere.push(`c.provider_id = $${catalogParams.length}`)
  }
  if (catalogSearch) {
    catalogParams.push(`%${catalogSearch}%`)
    catalogWhere.push(`c.game_name ilike $${catalogParams.length}`)
  }
  const catalogFilter = catalogWhere.length > 0 ? `where ${catalogWhere.join(' and ')}` : ''

  const [providers, games, products, editingProvider, editingGame, news, settings, catalog, catalogPrices] =
    await Promise.all([
    q<Provider>(
      `select p.id, p.name, p.kind, p.base_url, p.auth_type, (p.api_key is not null) as has_key,
              p.username, p.note, p.priority, p.is_active, p.sandbox,
              p.balance::float8 as balance, p.balance_at, p.low_balance::float8 as low_balance,
              (select count(*) from products pr where pr.provider_id = p.id)::int as products
         from api_providers p order by p.priority, p.name`
    ),
    q<GameRow>(
      `select g.id, g.name, g.image_url, g.description, g.is_published, g.sort_order,
              (select count(*) from sales s
                where s.game_id = g.id and s.status = 'paid'
                  and s.sold_at >= now() - interval '30 days')::int as recent_sales,
              (select count(*) from products p
                where p.game_id = g.id and p.is_published)::int as published_products,
              (select count(*) from products p where p.game_id = g.id)::int as total_products
         from games g order by g.is_published desc, g.sort_order, g.name`
    ),
    q<ProductRow>(
      `select p.id, p.game_id, g.name as game, p.name, p.sell_price::float8 as sell_price,
              p.is_published, ap.name as provider_name, p.provider_sku, p.provider_fields
         from products p
         join games g on g.id = p.game_id
         left join api_providers ap on ap.id = p.provider_id
        where p.is_active
        order by g.name, p.sell_price`
    ),
    editProvider
      ? q1<Provider>(
          `select id, name, kind, base_url, auth_type, (api_key is not null) as has_key,
                  username, note, priority, is_active, sandbox,
                  balance::float8 as balance, balance_at, low_balance::float8 as low_balance
             from api_providers where id = $1`,
          [Number(editProvider)]
        )
      : Promise.resolve(null),
    editGame
      ? q1<GameRow>(
          'select id, name, image_url, description, is_published, sort_order, order_field from games where id = $1',
          [Number(editGame)]
        )
      : Promise.resolve(null),
      q<NewsRow>(
        `select id, title, body, image_url, link_url, is_published, pinned, created_at
           from news order by pinned desc, created_at desc`
      ),
      getSiteSettings(),
      // ตารางรายการสินค้าของผู้ให้บริการมีหลายพันแถว และรวมกลุ่มทุกครั้งที่เปิดหน้า
      // ดึงเฉพาะตอนเปิดแท็บนี้จริง ๆ หน้าที่เหลือจะโหลดเร็วขึ้นมาก
      tab === 'catalog' && catalogProviderId !== null
      ? q<CatalogGame>(
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
          ${catalogFilter}
          group by c.provider_id, c.game_id
          order by min(c.game_name)`,
        catalogParams
      )
      : Promise.resolve([] as CatalogGame[]),
      // ราคาเริ่มต้นของทุกเกมของทุกเจ้า — ดึงมาทั้งชุดเพื่อเทียบว่าเกมเดียวกันเจ้าไหนถูกกว่า
      // (หนึ่งแถวต่อเกมต่อเจ้า ไม่ใช่รายแพ็กเกจ จึงเบากว่าตารางเต็มหลายสิบเท่า)
      tab === 'catalog'
      ? q<CatalogPrice>(
        `select c.provider_id, ap.name as provider_name, c.game_name,
                min(c.pack_price)::float8 as min_price
           from provider_catalog c
           join api_providers ap on ap.id = c.provider_id
          group by c.provider_id, ap.name, c.game_name`
      )
      : Promise.resolve([] as CatalogPrice[]),
    ])

  /**
   * เกมที่ผู้ให้บริการแยกเป็นหลายสินค้า (คนละ game_id แต่ชื่อเดียวกัน)
   * เช่น JCR แยก Lineage2M เป็น "โปรโมชั่นที่ 1/2/3" ซึ่งแต่ละชุดมีแพ็กเกจคนละชุดกัน
   * ถ้าไม่บอกไว้ คนจะติ๊กนำเข้าแค่แถวเดียวแล้วนึกว่าครบ — ที่จริงได้แพ็กเกจมาไม่ครบ
   */
  const catalogSets = new Map<string, { index: number; total: number }>()
  {
    const totals = new Map<string, number>()
    for (const g of catalog) {
      const key = gameKey(g.game_name)
      totals.set(key, (totals.get(key) ?? 0) + 1)
    }
    const seen = new Map<string, number>()
    for (const g of catalog) {
      const key = gameKey(g.game_name)
      const index = (seen.get(key) ?? 0) + 1
      seen.set(key, index)
      catalogSets.set(`${g.provider_id}-${g.game_id}`, { index, total: totals.get(key) ?? 1 })
    }
  }

  /**
   * ราคาเริ่มต้นของแต่ละเกม แยกตามผู้ให้บริการ — เก็บเฉพาะราคาที่ถูกที่สุดของเจ้านั้น
   * (เจ้าหนึ่งอาจมีชื่อเกมเดียวกันหลายรายการ เช่นแยกภูมิภาค)
   */
  const priceByGame = new Map<string, Map<number, { name: string; price: number }>>()
  for (const row of catalogPrices) {
    const key = gameKey(row.game_name)
    let byProvider = priceByGame.get(key)
    if (!byProvider) {
      byProvider = new Map()
      priceByGame.set(key, byProvider)
    }
    const current = byProvider.get(row.provider_id)
    if (!current || row.min_price < current.price) {
      byProvider.set(row.provider_id, { name: row.provider_name, price: row.min_price })
    }
  }

  const publishedGames = games.filter((g) => g.is_published).length
  const publishedProducts = products.filter((p) => p.is_published).length
  const unmapped = products.filter((p) => p.is_published && !p.provider_name).length

  /**
   * ช่องค้นหาแพ็กเกจ — ร้านมีเป็นพันรายการ เลื่อนหาเองไม่ไหว
   * กรองในหน่วยความจำ ไม่ยิงฐานข้อมูลใหม่ เพราะดึงมาครบอยู่แล้วและตัวเลขสรุปด้านบน
   * ต้องนับจากของทั้งหมดเสมอ (ถ้ากรองที่ SQL ตัวเลขสรุปจะเพี้ยนตามคำค้น)
   * ค้นได้ทั้งชื่อเกม ชื่อแพ็กเกจ รหัสสินค้าฝั่งผู้ให้บริการ และชื่อผู้ให้บริการ
   */
  const productSearch = (pq ?? '').trim()
  const productNeedle = productSearch.toLowerCase()
  const shownProducts = productNeedle
    ? products.filter((p) =>
        `${p.game} ${p.name} ${p.provider_sku ?? ''} ${p.provider_name ?? ''}`
          .toLowerCase()
          .includes(productNeedle)
      )
    : products

  const autoOn = await autoDispatchOn()

  // ประวัติที่ร้านเติมเงินให้ผู้ให้บริการ + ยอดรวมเดือนนี้และปีนี้ (ใช้ทำบัญชี)
  const [providerTopups, topupSummary] = await Promise.all([
    q<ProviderTopupRow>(
      `select t.id, t.provider_id, ap.name as provider_name,
              t.amount::float8 as amount, t.bonus::float8 as bonus,
              t.method, t.ref, t.note, t.slip_path, t.topped_up_at
         from provider_topups t
         left join api_providers ap on ap.id = t.provider_id
        order by t.topped_up_at desc, t.id desc
        limit 50`
    ),
    q<{ month: number; year: number }>(
      `select
         coalesce(sum(amount) filter (
           where topped_up_at >= date_trunc('month', (now() at time zone 'Asia/Bangkok')::date)
         ), 0)::float8 as month,
         coalesce(sum(amount) filter (
           where topped_up_at >= date_trunc('year', (now() at time zone 'Asia/Bangkok')::date)
         ), 0)::float8 as year
       from provider_topups`
    ),
  ])
  const topupTotals = topupSummary[0] ?? { month: 0, year: 0 }

  // ที่อยู่ webhook ของ LINE ต้องเป็นที่อยู่จริงของเว็บ จึงอ่านจาก header ของรีเควสต์
  // (ตอนย้ายโดเมนจะได้ขึ้นค่าใหม่ให้เอง ไม่ต้องมาแก้โค้ด)
  const headerList = await headers()
  const host = headerList.get('x-forwarded-host') ?? headerList.get('host') ?? ''
  const proto = headerList.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  const lineWebhookUrl = `${proto}://${host}/api/line-webhook`
  const lineLinked = Boolean(settings.line_target_id && settings.line_channel_token)
  // เจ้าที่เปิดใช้อยู่ ตั้งยอดเตือนไว้ และยอดคงเหลือต่ำกว่าที่ตั้ง
  const lowProviders = providers.filter(
    (p) => p.is_active && p.low_balance > 0 && p.balance != null && p.balance < p.low_balance
  )

  return (
    <>
      <PageHeader
        title="จัดการหน้าเว็บไซต์"
        subtitle="ตั้งค่าเกม รูปภาพ และแพ็กเกจที่จะแสดงบนหน้าเว็บสำหรับลูกค้า พร้อมผูกกับผู้ให้บริการ API ที่จะเติมให้"
      />

      <div className="mb-4 rounded-xl border border-good/30 bg-good/10 px-4 py-3 text-xs leading-relaxed text-good">
        <b>หน้าเว็บลูกค้าเปิดใช้งานแล้ว</b> —{' '}
        <a href="/shop" target="_blank" rel="noreferrer" className="underline">
          เปิดดูหน้าเว็บ ↗
        </a>{' '}
        ลูกค้าค้นหาเกม เลือกแพ็กเกจ ใส่จำนวน แล้วกดซื้อโดยตัดจากเครดิตที่ร้านเติมให้
        (เติมเครดิตได้ที่เมนู <b>รายชื่อลูกค้า</b>)
      </div>

      {/* ---------------- สวิตช์ส่งออเดอร์อัตโนมัติ ---------------- */}
      <div
        className={`mb-4 rounded-xl border px-4 py-3 ${
          autoOn ? 'border-good/30 bg-good/10' : 'border-warn/40 bg-warn/10'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className={`text-sm font-semibold ${autoOn ? 'text-good' : 'text-warn'}`}>
              {autoOn ? '⚡ ส่งออเดอร์อัตโนมัติ: เปิดอยู่' : '⏸ ส่งออเดอร์อัตโนมัติ: ปิดอยู่'}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-mute">
              {autoOn ? (
                <>
                  ลูกค้ากดซื้อ → ระบบตัดเครดิต → ยิงคำสั่งเติมไปยังผู้ให้บริการทันที
                  ถ้าปลายทางแจ้งว่าเติมไม่สำเร็จ <b className="text-slate-200">ระบบคืนเครดิตให้ลูกค้าเอง</b>
                </>
              ) : (
                <>
                  ออเดอร์ใหม่จะรอไว้ในคิว ให้พนักงานตรวจไอดีเกมแล้วกดปุ่ม{' '}
                  <b className="text-slate-200">ส่งให้ผู้ให้บริการ</b> เองที่หน้าลงยอดขาย
                </>
              )}
            </p>
          </div>
          <ActionForm action={toggleAutoDispatchAction}>
            <SubmitButton
              className={autoOn ? 'btn-ghost' : 'btn-primary'}
              pendingLabel="กำลังบันทึก..."
            >
              {autoOn ? 'ปิดการส่งอัตโนมัติ' : 'เปิดการส่งอัตโนมัติ'}
            </SubmitButton>
          </ActionForm>
        </div>
      </div>

      {/* เตือนเมื่อกระเป๋าเงินที่ผู้ให้บริการใกล้หมด — ถ้าหมดจริงออเดอร์จะส่งไม่ออกทั้งหมด */}
      {lowProviders.length > 0 ? (
        <div className="mb-4 rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-xs leading-relaxed text-bad">
          <b>⚠ ยอดที่ผู้ให้บริการใกล้หมด</b> —{' '}
          {lowProviders.map((p) => `${p.name} เหลือ ${money(p.balance ?? 0)}`).join(' · ')}{' '}
          เติมเงินเข้าบัญชีผู้ให้บริการก่อน ไม่งั้นออเดอร์ของลูกค้าจะส่งไม่ออก
        </div>
      ) : null}

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

      {/* แถบเลือกแท็บ — เลื่อนแนวนอนได้บนจอแคบ ไม่งั้นปุ่มจะตกบรรทัดจนสูงเป็นกำแพง */}
      <div className="mb-6 -mx-1 overflow-x-auto px-1">
        <div className="flex w-max gap-2">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/storefront?tab=${t.key}`}
              className={
                t.key === tab
                  ? 'whitespace-nowrap rounded-lg border border-brand-500/60 bg-brand-500/15 px-3 py-2 text-sm font-medium text-brand-400'
                  : 'whitespace-nowrap rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 text-sm text-slate-300 transition hover:border-ink-600 hover:bg-ink-800'
              }
            >
              {t.label}
            </Link>
          ))}
        </div>
      </div>

      {/* ---------------- ประวัติเติมเงินให้ผู้ให้บริการ ---------------- */}
      {tab === 'topups' ? (<>
      <div className="card mb-6">
          <SectionTitle
            right={
              <span className="text-xs text-mute">
                เก็บไว้เป็นหลักฐานต้นทุนตอนยื่นภาษี
              </span>
            }
          >
            ประวัติที่ร้านเติมเงินให้ผู้ให้บริการ
          </SectionTitle>
          <ProviderTopupPanel
            providers={providers.map((p) => ({ id: p.id, name: p.name }))}
            rows={providerTopups}
            monthTotal={topupTotals.month}
            yearTotal={topupTotals.year}
            today={todayISO()}
          />
      </div>

      </>) : null}
      {/* ---------------- แจ้งเตือนเข้า LINE ---------------- */}
      {tab === 'line' ? (<>
      <div className="card mb-6">
        <SectionTitle
          right={
            <span className={`text-xs ${lineLinked ? 'text-good' : 'text-mute'}`}>
              {lineLinked ? 'พร้อมใช้งาน' : 'ยังไม่ได้ตั้งค่า'}
            </span>
          }
        >
          แจ้งเตือนเข้า LINE เมื่อลูกค้าแจ้งโอนเงิน
        </SectionTitle>
        <LineNotifyPanel
          hasToken={Boolean(settings.line_channel_token)}
          hasSecret={Boolean(settings.line_channel_secret)}
          linked={lineLinked}
          webhookUrl={lineWebhookUrl}
        />
      </div>

      </>) : null}
      {/* ---------------- ผู้ให้บริการ API ---------------- */}
      {tab === 'providers' ? (<>
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
                    <th>ชนิด</th>
                    <th>คีย์</th>
                    <th>ยอดคงเหลือของร้านเรา</th>
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
                      <td className="text-xs text-slate-300">
                        {providerMeta(p.kind).autoSupported ? (
                          <Badge tone="good">ส่งอัตโนมัติได้</Badge>
                        ) : (
                          <Badge tone="warn">ต้องเติมเอง</Badge>
                        )}
                        {/* ต้องเห็นชัด ๆ ไม่งั้นจะสับสนว่าที่ทำอยู่เป็นของจริงหรือของทดสอบ */}
                        {p.sandbox ? (
                          <span className="mt-1 block">
                            <Badge tone="warn">🧪 โหมดทดสอบ</Badge>
                          </span>
                        ) : null}
                        {p.username ? (
                          <span className="mt-1 block font-mono text-xs text-mute">
                            {p.username}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        {p.has_key ? (
                          <Badge tone="good">ตั้งแล้ว</Badge>
                        ) : (
                          <Badge tone="warn">ยังไม่ตั้ง</Badge>
                        )}
                      </td>
                      {/* กระเป๋าเงินของร้านเราที่ปลายทาง — พอยต์หมดเมื่อไหร่ออเดอร์ส่งไม่ออกทันที */}
                      <td>
                        {p.balance == null ? (
                          <span className="text-xs text-mute">ยังไม่เคยเช็ก</span>
                        ) : (
                          <span
                            className={`block font-semibold ${
                              p.low_balance > 0 && p.balance < p.low_balance
                                ? 'text-bad'
                                : 'text-good'
                            }`}
                          >
                            {money(p.balance)}
                            <span className="ml-1 text-xs font-normal text-mute">
                              {providerMeta(p.kind).unit}
                            </span>
                          </span>
                        )}
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {providerMeta(p.kind).autoSupported ? (
                            <ActionForm action={refreshBalanceAction}>
                              <input type="hidden" name="provider_id" value={p.id} />
                              <SubmitButton className="btn-ghost btn-sm" pendingLabel="...">
                                เช็กยอด
                              </SubmitButton>
                            </ActionForm>
                          ) : null}
                          <ActionForm action={setLowBalanceAction}>
                            <input type="hidden" name="provider_id" value={p.id} />
                            <span className="flex items-center gap-1">
                              <span className="text-xs text-mute">เตือนต่ำกว่า</span>
                              <input
                                name="low_balance"
                                type="number"
                                min="0"
                                step="1"
                                className="input w-24 px-2 py-1 text-xs"
                                defaultValue={p.low_balance || ''}
                                placeholder="0"
                              />
                              <SubmitButton className="btn-ghost btn-sm" pendingLabel="...">
                                ตั้ง
                              </SubmitButton>
                            </span>
                          </ActionForm>
                        </div>
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

      </>) : null}
      {/* ---------------- รายการสินค้าจากผู้ให้บริการ ---------------- */}
      {tab === 'catalog' ? (<>
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
            รายการเกมจาก
            <span className="text-brand-400">
              {catalogProvider ? ` ${catalogProvider.provider_name}` : 'ผู้ให้บริการ'}
            </span>
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
              {/* OverTopup คิดราคาคนละระดับ ดึงผิดระดับ = ราคาทุนที่บันทึกไว้ไม่ตรงกับที่ถูกตัดจริง */}
              <label className="mt-2 flex items-center gap-2 text-xs text-slate-200">
                <input
                  type="checkbox"
                  name="vip"
                  className="size-4 rounded border-ink-600 bg-ink-850"
                />
                ร้านเราเป็นลูกค้าระดับ VIP (เฉพาะ OverTopup — ราคาทุนจะต่างจากระดับทั่วไป)
              </label>
            </ActionForm>

            {/* อัปเดตของที่นำเข้าไปแล้ว โดยไม่แตะราคาขายที่ร้านตั้งเอง */}
            <div className="mt-3 border-t border-ink-700 pt-3">
              <ActionForm action={refreshImportedAction}>
                <div className="flex flex-wrap gap-2">
                  <select
                    name="provider_id"
                    className="input w-auto flex-1"
                    required
                    defaultValue=""
                  >
                    <option value="" disabled>
                      — เลือกผู้ให้บริการ —
                    </option>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <SubmitButton className="btn-ghost" pendingLabel="กำลังอัปเดต...">
                    🔄 อัปเดตแพ็กเกจที่นำเข้าแล้ว
                  </SubmitButton>
                </div>
              </ActionForm>
              <p className="mt-2 text-xs leading-relaxed text-mute">
                ซิงก์ <b className="text-slate-200">ต้นทุน</b> และ{' '}
                <b className="text-slate-200">ช่องกรอกของลูกค้า</b> (เช่นตัวเลือกเซิร์ฟเวอร์)
                ให้แพ็กเกจที่นำเข้าไปแล้ว ·{' '}
                <b className="text-good">ราคาขายที่ตั้งเองไว้จะไม่ถูกแตะ</b>{' '}
                ส่วนแพ็กที่ตั้งกำไรเป็น % ไว้จะคิดราคาใหม่ให้กำไรเท่าเดิม ·
                กดหลังดึงรายการใหม่ทุกครั้ง
              </p>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-mute">
              ดึงเกม เซิร์ฟเวอร์ และแพ็กเกจทั้งหมดที่ผู้ให้บริการเปิดขายอยู่มาเก็บไว้
              แล้วกดนำเข้าทีละเกมได้เลย ไม่ต้องพิมพ์รหัสเกม/รหัสแพ็กเกจเอง
            </p>
          </div>

          {/* เลือกดูทีละเจ้า — ราคาของเจ้าอื่นจะไปแสดงเป็นคอลัมน์เทียบราคาในตารางแทน */}
          {catalogProviders.length > 0 ? (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-mute">ดูรายการของ</span>
              {catalogProviders.map((p) => {
                const active = p.provider_id === catalogProviderId
                const href = `/storefront?tab=catalog&cp=${p.provider_id}${
                  catalogSearch ? `&cq=${encodeURIComponent(catalogSearch)}` : ''
                }`
                return (
                  <Link
                    key={p.provider_id}
                    href={href}
                    className={`chip ${
                      active ? 'bg-brand-500/15 text-brand-400' : 'bg-ink-800 text-slate-300'
                    }`}
                  >
                    {p.provider_name}
                    <span className="ml-1 opacity-70">{num(p.games)} เกม</span>
                  </Link>
                )
              })}
              <span className="w-full text-xs text-mute">
                คอลัมน์ &ldquo;เทียบราคา&rdquo; จะบอกว่าเกมเดียวกันนี้เจ้าอื่นเริ่มต้นเท่าไร
                (จับคู่จากชื่อเกม — ชื่อที่เขียนต่างกันมากจะเทียบให้ไม่ได้)
              </span>
            </div>
          ) : null}

          <form method="get" className="mb-4 flex gap-2">
            <input type="hidden" name="tab" value="catalog" />
            {catalogProviderId !== null ? (
              <input type="hidden" name="cp" value={catalogProviderId} />
            ) : null}
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
            /* ฟอร์มเดียวครอบทั้งตาราง — ติ๊กเลือกหลายเกมแล้วกดนำเข้าทีเดียว
               ผู้ให้บริการมีเป็นร้อยเกม กดนำเข้าทีละเกมไม่ไหว */
            <ActionForm action={importGamesAction}>
              <input type="hidden" name="provider_id" value={catalogProviderId ?? ''} />

              <div className="mb-3 rounded-xl border border-brand-500/30 bg-brand-500/10 p-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label className="label" htmlFor="import_markup">
                      บวกกำไรจากต้นทุน (%)
                    </label>
                    <input
                      id="import_markup"
                      name="markup"
                      type="number"
                      min={0}
                      step="0.01"
                      className="input w-32"
                      placeholder="เช่น 15"
                      defaultValue={0}
                    />
                  </div>
                  <label className="flex items-center gap-2 pb-2.5 text-sm text-slate-200">
                    <input
                      type="checkbox"
                      name="publish"
                      className="size-4 rounded border-ink-600 bg-ink-850"
                    />
                    เปิดขายบนเว็บทันที
                  </label>
                  <div className="flex flex-wrap gap-2 pb-1">
                    <SubmitButton className="btn-primary" pendingLabel="กำลังนำเข้า...">
                      นำเข้าเกมที่เลือก
                    </SubmitButton>
                    <SubmitButton
                      name="all"
                      value="1"
                      className="btn-ghost"
                      pendingLabel="กำลังนำเข้า..."
                    >
                      {/* ปุ่มนี้นำเข้าทุกเกมของเจ้านี้เสมอ ไม่สนคำค้น จึงต้องบอกให้ตรง */}
                      {catalogSearch
                        ? `นำเข้าทั้งหมดของเจ้านี้ (${num(catalogProvider?.games ?? 0)} เกม)`
                        : `นำเข้าทั้งหมด (${num(catalog.length)} เกม)`}
                    </SubmitButton>
                  </div>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-mute">
                  ราคาขาย = ต้นทุน + กำไร แล้วปัดขึ้นเป็นจำนวนเต็มบาท ·
                  แพ็กเกจที่เคยนำเข้าแล้วจะถูกข้ามให้เอง กดซ้ำได้ปลอดภัย ·
                  ไม่ติ๊กเปิดขาย = นำเข้าไปเงียบ ๆ ก่อน แล้วค่อยไปเปิดทีหลังที่หน้าเกม
                </p>
              </div>

              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th className="w-10">เลือก</th>
                      <th>เกมฝั่งผู้ให้บริการ</th>
                      <th className="text-right">แพ็กเกจ</th>
                      <th className="text-right">ช่วงราคาทุน</th>
                      <th>เทียบราคาเริ่มต้นกับเจ้าอื่น</th>
                      <th>สถานะในระบบเรา</th>
                    </tr>
                  </thead>
                  <tbody>
                    {catalog.map((g) => {
                      // เกมเดียวกันที่เจ้าอื่นมีขาย เรียงจากถูกไปแพง
                      const rivals = priceByGame.get(gameKey(g.game_name))
                      const others = rivals
                        ? [...rivals]
                            .filter(([id]) => id !== g.provider_id)
                            .sort((a, b) => a[1].price - b[1].price)
                        : []
                      const cheapestRival = others[0]?.[1].price ?? null
                      // เท่ากันถือว่าถูกสุดด้วย (บวกเผื่อเศษสตางค์จากการปัด)
                      const weAreCheapest =
                        cheapestRival === null || g.min_price <= cheapestRival + 0.01
                      return (
                      <tr key={`${g.provider_id}-${g.game_id}`}>
                        <td>
                          <input
                            type="checkbox"
                            name="game_ids"
                            value={g.game_id}
                            className="size-4 rounded border-ink-600 bg-ink-850"
                            aria-label={`เลือก ${g.game_name}`}
                          />
                        </td>
                        <td>
                          <span className="block font-medium text-white">{g.game_name}</span>
                          <span className="block font-mono text-xs text-mute">
                            game_id {g.game_id}
                            {g.servers > 1 ? ` · ${num(g.servers)} เซิร์ฟเวอร์` : ''}
                          </span>
                          {/* ชื่อซ้ำ = ผู้ให้บริการแยกเป็นหลายชุด (โปรโมชั่น/รอบเติม)
                              แต่ละชุดมีแพ็กเกจคนละชุด ต้องนำเข้าให้ครบถึงจะได้ของครบ */}
                          {(catalogSets.get(`${g.provider_id}-${g.game_id}`)?.total ?? 1) > 1 ? (
                            <span className="mt-1 inline-block">
                              <Badge tone="warn">
                                ชุดที่ {catalogSets.get(`${g.provider_id}-${g.game_id}`)?.index} จาก{' '}
                                {catalogSets.get(`${g.provider_id}-${g.game_id}`)?.total} —
                                ต้องนำเข้าให้ครบทุกชุด
                              </Badge>
                            </span>
                          ) : null}
                        </td>
                        <td className="text-right">{num(g.packs)}</td>
                        <td className="text-right">
                          <span className={weAreCheapest ? 'text-good' : 'text-mute'}>
                            {money(g.min_price)}
                          </span>
                          <span className="text-mute"> – {money(g.max_price)}</span>
                        </td>
                        <td>
                          {others.length === 0 ? (
                            <span className="text-xs text-mute">— มีเจ้านี้เจ้าเดียว</span>
                          ) : (
                            <div className="space-y-0.5 text-xs">
                              {others.map(([id, o]) => (
                                <div key={id} className="flex items-center gap-2">
                                  <span className="text-mute">{o.name}</span>
                                  <span
                                    className={
                                      o.price < g.min_price - 0.01
                                        ? 'font-semibold text-good'
                                        : 'text-slate-300'
                                    }
                                  >
                                    เริ่มต้น {money(o.price)}
                                  </span>
                                </div>
                              ))}
                              <div className="pt-0.5">
                                {weAreCheapest ? (
                                  <Badge tone="good">เจ้านี้ถูกสุด</Badge>
                                ) : (
                                  <Badge tone="bad">
                                    แพงกว่า {money(g.min_price - (cheapestRival ?? 0))}
                                  </Badge>
                                )}
                              </div>
                            </div>
                          )}
                        </td>
                        <td>
                          {g.imported > 0 ? (
                            <Badge tone="good">นำเข้าแล้ว {num(g.imported)}</Badge>
                          ) : (
                            <Badge tone="warn">ยังไม่นำเข้า</Badge>
                          )}
                        </td>
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </ActionForm>
          )}
        </div>
      ) : null}

      </>) : null}
      {/* ---------------- เกมบนหน้าเว็บ ---------------- */}
      {tab === 'games' ? (<>
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
              {/* ผู้ให้บริการบางเจ้าไม่บอกมาว่าเกมนี้ขออะไร ทุกเกมเลยขึ้นเป็น UID เหมือนกันหมด
                  ตรงนี้ให้ระบุเองรายเกมได้ว่าลูกค้าต้องกรอกอะไรจริง ๆ */}
              <div>
                <label className="label" htmlFor="order_field">
                  ลูกค้าต้องกรอกอะไรตอนสั่งซื้อ
                </label>
                <select
                  id="order_field"
                  name="order_field"
                  className="input"
                  defaultValue={editingGame.order_field ?? ''}
                >
                  <option value="">ตามที่ผู้ให้บริการกำหนด (ค่าเริ่มต้น)</option>
                  {ORDER_FIELDS.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.adminLabel}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs leading-relaxed text-mute">
                  ใช้ตอนที่ผู้ให้บริการไม่ได้บอกมาว่าเกมนี้ขออะไร (เช่น 24BUYM ไม่ส่งข้อมูลนี้มาเลย)
                  ทุกเกมจึงขึ้นเป็น &quot;ไอดีเกม / UID&quot; เหมือนกันหมด ·
                  เลือกให้ตรงแล้วหน้าเว็บจะเปลี่ยนชื่อช่องและคำอธิบายให้เอง
                </p>
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
                    <th className="text-right">ขาย 30 วัน</th>
                    <th>ลำดับบนเว็บ</th>
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
                      {/* หน้าเว็บเรียงตามยอดขาย 30 วันล่าสุด ให้เห็นตัวเลขที่ใช้เรียงจริง */}
                      <td className="text-right">
                        {g.recent_sales > 0 ? (
                          <span className="text-good">{num(g.recent_sales)}</span>
                        ) : (
                          <span className="text-mute">—</span>
                        )}
                      </td>
                      <td>
                        <form action={togglePinGameAction}>
                          <input type="hidden" name="id" value={g.id} />
                          <button
                            type="submit"
                            className="btn-ghost btn-sm"
                            title={
                              g.sort_order < 100
                                ? 'กดเพื่อเลิกปักหมุด กลับไปเรียงตามยอดขาย'
                                : 'กดเพื่อดันเกมนี้ขึ้นก่อนบนหน้าเว็บ'
                            }
                          >
                            {g.sort_order < 100 ? '📌 ปักหมุดอยู่' : 'เรียงตามยอดขาย'}
                          </button>
                        </form>
                      </td>
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

      </>) : null}
      {/* ---------------- แพ็กเกจกับการผูก API ---------------- */}
      {tab === 'products' ? (<>
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
        {/* ค้นหาแพ็กเกจ — พิมพ์ชื่อเกม ชื่อแพ็ก รหัสสินค้า หรือชื่อผู้ให้บริการก็ได้ */}
        {products.length > 0 ? (
          <form method="get" className="mb-4 flex flex-wrap gap-2">
            <input type="hidden" name="tab" value="products" />
            <input
              name="pq"
              className="input flex-1"
              defaultValue={productSearch}
              placeholder="ค้นหา: ชื่อเกม, ชื่อแพ็กเกจ, รหัสสินค้า หรือชื่อผู้ให้บริการ (เช่น JCR)"
              aria-label="ค้นหาแพ็กเกจ"
            />
            <button type="submit" className="btn-ghost">
              ค้นหา
            </button>
            {productSearch ? (
              <Link href="/storefront?tab=products" className="btn-ghost">
                ล้าง
              </Link>
            ) : null}
            {productSearch ? (
              <span className="w-full text-xs text-mute">
                พบ {num(shownProducts.length)} รายการ จากทั้งหมด {num(products.length)} ·
                ปุ่มเปิด/ซ่อนทั้งหมดด้านบนยังคงมีผลกับ<b className="text-slate-200">ทุกแพ็กเกจ</b>
                ไม่ใช่เฉพาะที่ค้นเจอ
              </span>
            ) : null}
          </form>
        ) : null}

        {products.length === 0 ? (
          <Empty>ยังไม่มีแพ็กเกจ</Empty>
        ) : shownProducts.length === 0 ? (
          <Empty>ไม่พบแพ็กเกจที่ตรงกับ &ldquo;{productSearch}&rdquo;</Empty>
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
                {shownProducts.map((p) => (
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
                      {/* ลูกค้าจะถูกถามอะไรบ้างตอนสั่ง — ต้องตรงกับที่ผู้ให้บริการกำหนด
                          ถามไม่ครบ = ออเดอร์ถูกปฏิเสธ หรือเติมเข้าผิดเซิร์ฟเวอร์
                          ตรวจได้จากตรงนี้เลย ไม่ต้องไปเปิดหน้าเว็บลูกค้าดูทีละเกม */}
                      <span className="mt-1 block text-xs text-mute">
                        {(() => {
                          const spec = jsonArray<{ key: string; label: string }>(p.provider_fields)
                          if (!spec || spec.length === 0) return 'ถามแค่ไอดีเกม'
                          return `ถาม: ${spec.map((f) => f.label || f.key).join(', ')}`
                        })()}
                      </span>
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

      </>) : null}
      {/* ---------------- ข่าวสาร + ช่องทางติดต่อ ---------------- */}
      {tab === 'site' ? (<>
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
      </>) : null}
    </>
  )
}
