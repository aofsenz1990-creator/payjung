import 'server-only'
import { q, q1 } from './db'
import { jsonRecord } from './json'
import { adapterFor, supportsAuto, toConfig } from './providers/registry'
import { ProviderError, type CheckResult } from './providers/types'
import { providerMeta } from './providers/constants'

/**
 * เครื่องยนต์ส่งออเดอร์ต่อไปยังผู้ให้บริการเติมเกม
 *
 * ลำดับเงินทั้งระบบ:
 *   ① ลูกค้ากดซื้อ  → ตัดเครดิตลูกค้า + ออกบิล        (กระเป๋าใบที่ 1 ในระบบเรา)
 *   ② ส่งออเดอร์    → ผู้ให้บริการตัดพอยต์ของร้านเรา   (กระเป๋าใบที่ 2 ที่ปลายทาง)
 *   ③ ตามสถานะ     → สำเร็จ = ปิดบิล / ล้มเหลว = คืนเครดิตลูกค้าอัตโนมัติ
 *
 * กฎเหล็กของไฟล์นี้: **ห้ามเติมซ้ำเด็ดขาด**
 * ป้องกันสามชั้น —
 *   ชั้นที่ 1 ล็อกด้วย SQL (เปลี่ยนสถานะเป็น 'sending' ได้แค่คนเดียว)
 *   ชั้นที่ 2 ก่อนส่งซ้ำทุกครั้ง ถามปลายทางก่อนว่าออเดอร์เดิมเข้าไปแล้วหรือยัง
 *   ชั้นที่ 3 unique index บน sales.provider_ref ที่ระดับฐานข้อมูล
 */

import type { DispatchState } from './constants'

/** ค่าใน site_settings ที่ใช้เป็นสวิตช์เปิด/ปิดการส่งอัตโนมัติ */
export const AUTO_DISPATCH_KEY = 'auto_dispatch'

/** ยอดคงเหลือที่แคชไว้ ถ้าเก่ากว่านี้ให้ยิงถามปลายทางใหม่ */
const BALANCE_TTL_MS = 3 * 60 * 1000

/** ส่งไม่สำเร็จเกินจำนวนนี้แล้วหยุด รอให้คนเข้ามาดู */
export const MAX_ATTEMPTS = 5

/** ไม่ถามสถานะออเดอร์เดิมถี่กว่านี้ (วินาที) กันยิง API รัว ๆ ตอนหลายคนเปิดหน้าแดชบอร์ดพร้อมกัน */
const RECHECK_SEC = 15

/** ค้างสถานะ "กำลังส่ง" นานกว่านี้ (วินาที) ถือว่าเซิร์ฟเวอร์ถูกตัดกลางคัน ให้ดึงกลับเข้าคิว */
const STUCK_SEC = 120

/** จำนวนออเดอร์สูงสุดที่จัดการต่อการเรียกหนึ่งครั้ง กันหน้าเว็บค้าง */
const BATCH = 8

/** เปิดส่งอัตโนมัติอยู่ไหม (ไม่เคยตั้งค่า = เปิด) */
export async function autoDispatchOn() {
  const row = await q1<{ value: string | null }>(
    'select value from site_settings where key = $1',
    [AUTO_DISPATCH_KEY]
  )
  return (row?.value ?? 'on') !== 'off'
}

type ProviderRow = {
  id: number
  name: string
  kind: string
  base_url: string | null
  username: string | null
  api_key: string | null
  balance: number | null
  balance_at: string | Date | null
  sandbox?: boolean | null
}

/**
 * ยอดกระเป๋าของร้านเราที่ผู้ให้บริการ
 * ใช้ค่าที่แคชไว้ถ้ายังใหม่พอ เพื่อไม่ให้ลูกค้ารอนานตอนกดซื้อ
 */
export async function providerBalance(row: ProviderRow, opts: { force?: boolean } = {}) {
  const fresh =
    row.balance_at != null && Date.now() - new Date(row.balance_at).getTime() < BALANCE_TTL_MS
  if (!opts.force && fresh && row.balance != null) {
    return {
      balance: Number(row.balance),
      unit: providerMeta(row.kind).unit,
      account: null,
      cached: true,
    }
  }

  const result = await adapterFor(row.kind).getBalance(toConfig(row))
  await q('update api_providers set balance = $2, balance_at = now() where id = $1', [
    row.id,
    result.balance,
  ])
  return { balance: result.balance, unit: result.unit, account: result.account, cached: false }
}

/**
 * ทำเครื่องหมายว่าบิลนี้ต้องส่งต่อให้ผู้ให้บริการ
 * เรียกทันทีหลังออกบิล — คัดลอกผู้ให้บริการมาจากแพ็กเกจที่ลูกค้าซื้อ
 * แพ็กเกจที่ยังไม่ได้ผูกกับเจ้าไหน จะไม่ถูกทำเครื่องหมาย (ปล่อยให้พนักงานเติมเอง)
 */
export async function markForDispatch(saleId: number) {
  const rows = await q<{ id: number }>(
    // เลขอ้างอิงตัดเหลือแต่ตัวอักษรกับตัวเลข 15 ตัว เพราะ OverTopup รับได้เท่านี้
    // (เลขบิลเรา PJ-250816-001 -> PJ250816001 ยังไม่ซ้ำกัน และ unique index คุมอีกชั้น)
    `update sales s
        set provider_id = p.provider_id,
            provider_ref = left(regexp_replace(s.code, '[^A-Za-z0-9]', '', 'g'), 15),
            provider_state = 'queued'
       from products p
      where s.id = $1
        and p.id = s.product_id
        and p.provider_id is not null
        and p.provider_sku is not null
        and p.provider_game_id is not null
        and s.provider_state is null
     returning s.id`,
    [saleId]
  )
  return rows.length > 0
}

/**
 * แถวที่ได้จากการล็อกบิล — ตั้งชื่อคอลัมน์ของผู้ให้บริการขึ้นต้นด้วย p_ ทุกตัว
 * เพราะทั้ง sales และ api_providers ต่างก็มีคอลัมน์ชื่อ id ถ้าไม่แยกชื่อจะทับกัน
 */
type ClaimRow = {
  sale_id: number
  code: string
  qty: number
  game_account: string | null
  provider_fields: unknown
  cost_total: number
  provider_ref: string | null
  provider_order_id: string | null
  provider_attempts: number
  provider_game_id: string | null
  provider_server_id: string | null
  provider_sku: string | null
  provider_product_type: string | null
  unit_cost: number
  p_id: number | null
  p_name: string | null
  p_kind: string | null
  p_base_url: string | null
  p_username: string | null
  p_api_key: string | null
  p_balance: number | null
  p_balance_at: string | Date | null
  p_sandbox: boolean | null
}

/** บันทึกผลลงบิล — ใช้ตอนจบรอบไม่ว่าจะสำเร็จหรือไม่ */
async function setState(
  saleId: number,
  state: DispatchState,
  message: string,
  orderId?: string | null
) {
  await q(
    `update sales
        set provider_state = $2,
            provider_message = left($3, 300),
            provider_order_id = coalesce($4, provider_order_id),
            provider_checked_at = now()
      where id = $1`,
    [saleId, state, message, orderId ?? null]
  )
  return { state, message }
}

/**
 * ปลายทางแจ้งว่าเติมไม่สำเร็จ — คืนเครดิตให้ลูกค้าอัตโนมัติ
 * ทั้งหมดอยู่ในคำสั่งเดียว และกันคืนซ้ำด้วยการเช็กว่าเคยมีรายการ refund ของบิลนี้แล้วหรือยัง
 * (ใช้เงื่อนไขชุดเดียวกับปุ่มคืนเครดิตในหน้าลงยอดขาย จะได้ไม่มีทางคืนสองรอบ)
 */
async function refundFailed(saleId: number, reason: string) {
  const rows = await q<{ refunded: number; balance_after: number }>(
    `with s as (
       update sales
          set status = 'cancelled',
              provider_state = 'failed',
              provider_message = left($2, 300),
              provider_checked_at = now()
        where id = $1
          and status <> 'cancelled'
          and customer_id is not null
          and not exists (
            select 1 from credit_transactions t where t.sale_id = sales.id and t.kind = 'refund'
          )
       returning id, customer_id, product_id, qty, unit_cost, total, points_earned
     ),
     cust as (
       -- คืนเงินแล้วต้องยึดเครดิตที่แถมไปคืนด้วย ไม่งั้นจะกลายเป็นช่องปั๊มเครดิตฟรี
       -- (สั่งด้วยไอดีมั่ว → เติมไม่สำเร็จ → ได้เงินคืนครบแต่เครดิตยังอยู่ → ทำซ้ำ)
       -- greatest กันยอดติดลบ เผื่อลูกค้าใช้เครดิตไปแล้วก่อนบิลจะถูกคืน
       update customers
          set credit = customers.credit + s.total,
              points = greatest(customers.points - s.points_earned, 0)
         from s where customers.id = s.customer_id
       returning customers.id, customers.credit, customers.points
     ),
     tx as (
       insert into credit_transactions (customer_id, kind, amount, balance_after, note, sale_id)
       select cust.id, 'refund', s.total, cust.credit,
              'คืนเครดิตอัตโนมัติ — ผู้ให้บริการเติมไม่สำเร็จ', s.id
         from cust, s
     ),
     ptx as (
       insert into point_transactions (customer_id, kind, points, balance_after, note)
       select cust.id, 'revoke', -s.points_earned, cust.points,
              'ยึดเครดิตคืนจากบิลที่เติมไม่สำเร็จ'
         from cust, s where s.points_earned > 0
     ),
     upd as (
       update products set stock_qty = products.stock_qty + s.qty
         from s where products.id = s.product_id and products.track_stock
       returning products.id
     ),
     mv as (
       insert into stock_movements (product_id, kind, qty, unit_cost, note, sale_id)
       select s.product_id, 'in', s.qty, s.unit_cost, 'คืนสต๊อกจากการเติมไม่สำเร็จ', s.id
         from s join products p on p.id = s.product_id where p.track_stock
     )
     select s.total::float8 as refunded, cust.credit::float8 as balance_after from s, cust`,
    [saleId, reason]
  )

  if (rows.length === 0) {
    // คืนไปแล้ว หรือบิลถูกยกเลิกไปก่อน — แค่บันทึกสถานะไว้ ไม่แตะเงินซ้ำ
    return setState(saleId, 'failed', reason)
  }
  return { state: 'failed' as const, message: reason }
}

/**
 * URL ที่ให้ผู้ให้บริการยิงผลกลับมา
 * ต้องมีกุญแจลับอยู่ใน path ไม่งั้นใครก็ยิงมาปลอมสถานะ "เติมสำเร็จ" ได้
 * ยังไม่ตั้งกุญแจ = ส่ง path ที่ไม่ทำอะไร (บางเจ้าบังคับให้ส่งฟิลด์นี้) แล้วใช้การตามสถานะแทน
 */
export function callbackUrl() {
  const base =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : null)
  if (!base) return null
  const secret = process.env.PROVIDER_CALLBACK_SECRET
  return `${base.replace(/\/+$/, '')}/api/provider-callback/${secret || 'disabled'}`
}

/** เอาผลที่ได้จากปลายทางมาลงบิล */
async function applyCheck(saleId: number, result: CheckResult) {
  if (result.state === 'success') {
    await q(
      `update sales
          set provider_state = 'success',
              provider_message = left($2, 300),
              provider_order_id = coalesce($3, provider_order_id),
              provider_checked_at = now(),
              status = case when status = 'pending' then 'paid' else status end
        where id = $1`,
      [saleId, result.message, result.orderId ?? null]
    )
    return { state: 'success' as const, message: result.message }
  }
  if (result.state === 'failed') return refundFailed(saleId, result.message)
  // จบแล้วแต่สรุปไม่ได้ว่าเติมเข้าหรือไม่ / ตรวจสอบไม่ได้ — พักไว้ให้คนตัดสิน ห้ามคืนเงินเอง
  if (result.state === 'attention' || result.state === 'unknown') {
    return setState(saleId, 'error', result.message, result.orderId)
  }
  return setState(saleId, 'sent', result.message, result.orderId)
}

/**
 * รับผลที่ผู้ให้บริการยิงกลับมาเอง (callback)
 * จับคู่กลับเข้าบิลด้วยเลขอ้างอิงที่เราส่งไป จึงใช้ได้แม้ตอนยิงออเดอร์ไปแล้วไม่ได้ผลกลับ
 * ซึ่งเป็นทางเดียวที่จะรู้เลขออเดอร์ของ OverTopup ในกรณีนั้น
 */
export async function applyCallback(input: {
  ref: string
  orderId: string | null
  result: CheckResult
}) {
  const sale = await q1<{ id: number; provider_state: string | null }>(
    'select id, provider_state from sales where provider_ref = $1',
    [input.ref]
  )
  if (!sale) return { matched: false as const }

  // บิลที่จบไปแล้วไม่ต้องแตะซ้ำ กัน callback ที่ยิงมาซ้ำหรือมาช้าย้อนสถานะ
  if (sale.provider_state === 'success' || sale.provider_state === 'failed') {
    return { matched: true as const, skipped: true as const }
  }

  // เก็บเลขออเดอร์ที่เพิ่งรู้ไว้ก่อน จะได้ตามสถานะเองได้ในรอบถัดไป
  if (input.orderId) {
    await q(
      'update sales set provider_order_id = coalesce(provider_order_id, $2) where id = $1',
      [sale.id, input.orderId]
    )
  }

  await applyCheck(sale.id, input.result)
  return { matched: true as const, skipped: false as const }
}

/**
 * ส่งออเดอร์หนึ่งบิลไปยังผู้ให้บริการ
 * เรียกซ้ำได้เสมอ ถ้ามีคนอื่นกำลังส่งอยู่หรือส่งไปแล้วจะไม่ทำอะไร
 */
export async function dispatchSale(saleId: number) {
  // ── ชั้นที่ 1: ล็อกด้วย SQL — เปลี่ยนเป็น 'sending' สำเร็จแค่คนเดียวเท่านั้น ──
  const claimed = await q<ClaimRow>(
    `with c as (
       update sales
          set provider_state = 'sending',
              provider_attempts = provider_attempts + 1,
              provider_checked_at = now()
        where id = $1
          and provider_state in ('queued', 'error')
          and status <> 'cancelled'
          and provider_attempts < $2
       returning id, code, status, qty, game_account, provider_fields,
                 cost_total::float8 as cost_total, unit_cost::float8 as unit_cost,
                 provider_id, provider_ref, provider_order_id, provider_attempts, product_id
     )
     select c.id as sale_id, c.code, c.qty, c.game_account, c.provider_fields,
            c.cost_total, c.unit_cost,
            c.provider_ref, c.provider_order_id, c.provider_attempts,
            p.provider_game_id, p.provider_server_id, p.provider_sku, p.provider_product_type,
            ap.id as p_id, ap.name as p_name, ap.kind as p_kind,
            ap.base_url as p_base_url, ap.username as p_username, ap.api_key as p_api_key,
            ap.balance::float8 as p_balance, ap.balance_at as p_balance_at,
            ap.sandbox as p_sandbox
       from c
       left join products p on p.id = c.product_id
       left join api_providers ap on ap.id = c.provider_id`,
    [saleId, MAX_ATTEMPTS]
  )

  const sale = claimed[0]
  if (!sale) return null // คนอื่นจัดการอยู่ / ส่งไปแล้ว / ครบจำนวนครั้งแล้ว

  // ข้อมูลไม่ครบ — ไม่ต้องลองใหม่ เพราะลองกี่ครั้งก็เหมือนเดิม
  if (!sale.p_id || !sale.p_name || !sale.p_kind) {
    return setState(saleId, 'manual', 'แพ็กเกจนี้ยังไม่ได้ผูกกับผู้ให้บริการ')
  }
  if (!sale.provider_sku || !sale.provider_game_id) {
    return setState(saleId, 'manual', 'แพ็กเกจนี้ยังไม่ได้จับคู่รหัสสินค้าฝั่งผู้ให้บริการ')
  }
  if (!sale.game_account) {
    return setState(saleId, 'manual', 'บิลนี้ไม่มีไอดีเกมของลูกค้า')
  }
  if (!supportsAuto(sale.p_kind)) {
    return setState(
      saleId,
      'manual',
      `"${sale.p_name}" ยังไม่รองรับการสั่งอัตโนมัติ — กดเติมเองที่หน้าลงยอดขาย`
    )
  }

  const provider: ProviderRow = {
    id: sale.p_id,
    name: sale.p_name,
    kind: sale.p_kind,
    base_url: sale.p_base_url,
    username: sale.p_username,
    api_key: sale.p_api_key,
    balance: sale.p_balance,
    balance_at: sale.p_balance_at,
    sandbox: sale.p_sandbox,
  }
  const adapter = adapterFor(provider.kind)
  const ref = sale.provider_ref || sale.code

  try {
    const config = toConfig(provider)

    // ── ชั้นที่ 2: เคยลองส่งมาก่อนแล้ว ต้องถามปลายทางก่อนว่าเข้าไปหรือยัง ──
    // ครั้งแรก provider_attempts จะเป็น 1 (เพิ่งบวกไปตอนล็อก) จึงข้ามขั้นนี้
    if (sale.provider_attempts > 1) {
      const existing = await adapter.checkOrder(config, {
        ref,
        orderId: sale.provider_order_id ?? null,
        productType: sale.provider_product_type,
      })
      if (existing.state !== 'missing') return applyCheck(saleId, existing)
    }

    // เช็กกระเป๋าร้านก่อนยิง — พอยต์ไม่พอแล้วยิงไปก็เสียเที่ยว
    const wallet = await providerBalance(provider)
    if (wallet.balance < sale.cost_total) {
      return setState(
        saleId,
        'error',
        `${provider.name} เหลือ ${wallet.balance.toLocaleString('th-TH')} ${wallet.unit} ` +
          `ไม่พอจ่าย ${sale.cost_total.toLocaleString('th-TH')} — เติมเงินเข้าบัญชีผู้ให้บริการก่อน`
      )
    }

    const placed = await adapter.placeOrder(config, {
      ref,
      gameId: sale.provider_game_id,
      serverId: sale.provider_server_id || '0',
      sku: sale.provider_sku,
      quantity: sale.qty,
      account: sale.game_account,
      // ค่าที่ลูกค้ากรอกตอนสั่ง (เช่นเซิร์ฟเวอร์ที่เลือก) ต้องส่งไปให้ครบ
      fields: jsonRecord(sale.provider_fields),
      productType: sale.provider_product_type,
      callbackUrl: callbackUrl(),
      // ส่งราคาทุนที่เราบันทึกไว้ไปให้ปลายทางตรวจ ถ้าเขาขึ้นราคาแล้วเราไม่รู้
      // ออเดอร์จะถูกปฏิเสธแทนที่จะตัดเงินตามราคาใหม่เงียบ ๆ
      unitPrice: sale.unit_cost,
    })

    await q(
      `update sales
          set provider_state = 'sent',
              provider_order_id = $2,
              provider_message = left($3, 300),
              provider_sent_at = now(),
              provider_checked_at = now()
        where id = $1`,
      [saleId, placed.orderId, placed.message]
    )
    // ตัดพอยต์ที่แคชไว้ตามยอดที่เพิ่งใช้ไป จะได้ไม่ต้องยิงถามใหม่ทุกออเดอร์
    await q('update api_providers set balance = greatest(balance - $2, 0) where id = $1', [
      provider.id,
      sale.cost_total,
    ])

    return { state: 'sent' as const, message: placed.message }
  } catch (err) {
    if (err instanceof ProviderError) {
      // ลองใหม่ได้ → กลับไปเข้าคิว (รอบหน้าจะถามปลายทางก่อนส่งซ้ำเสมอ)
      // ลองใหม่ไม่ได้ → พักไว้ให้คนตัดสินใจ ไม่คืนเงินเองเพราะยังไม่แน่ใจว่าออเดอร์เข้าไปไหม
      return setState(saleId, err.retryable ? 'queued' : 'error', err.message)
    }
    const message = err instanceof Error ? err.message : String(err)
    return setState(saleId, 'error', `ระบบขัดข้อง: ${message}`)
  }
}

/**
 * ตามสถานะออเดอร์ที่ยังไม่จบ และส่งออเดอร์ที่ตกค้างในคิว
 * เรียกจากหน้าแดชบอร์ดตอนที่พนักงานเปิดหน้าเว็บทิ้งไว้ (ทุก 10 วินาที)
 * ทำงานเงียบ ๆ ถ้าพลาดรอบนี้ก็ไปต่อรอบหน้า
 */
export async function syncPendingSales({ budgetMs = 6000 } = {}) {
  let changed = 0
  // Vercel จำกัดเวลาทำงานต่อรีเควสต์ ทำเท่าที่ทันในงบเวลาแล้วหยุด ที่เหลือไปต่อรอบหน้า
  const deadline = Date.now() + budgetMs
  const outOfTime = () => Date.now() > deadline

  // ⓪ กู้บิลที่ค้างสถานะ 'sending'
  // เกิดได้ถ้าเซิร์ฟเวอร์ถูกตัดกลางคันตอนกำลังยิง (Vercel จำกัดเวลาทำงานต่อรีเควสต์)
  // ดึงกลับเข้าคิว — รอบถัดไปจะถามปลายทางก่อนส่งซ้ำเสมอ จึงไม่มีทางเติมสองรอบ
  await q(
    `update sales set provider_state = 'queued'
      where provider_state = 'sending'
        and provider_checked_at < now() - make_interval(secs => $1)`,
    [STUCK_SEC]
  )

  // ① ตามสถานะออเดอร์ที่ปลายทางรับไปแล้ว
  const waiting = await q<{
    id: number
    provider_order_id: string | null
    provider_ref: string
    provider_product_type: string | null
  }>(
    `select s.id, s.provider_order_id, coalesce(s.provider_ref, s.code) as provider_ref,
            (select p.provider_product_type from products p where p.id = s.product_id)
              as provider_product_type
       from sales s
      where s.provider_state = 'sent'
        and (s.provider_checked_at is null
             or s.provider_checked_at < now() - make_interval(secs => $1))
      order by s.provider_sent_at
      limit $2`,
    [RECHECK_SEC, BATCH]
  )

  for (const row of waiting) {
    if (outOfTime()) return changed
    const provider = await q1<ProviderRow>(
      `select ap.id, ap.name, ap.kind, ap.base_url, ap.username, ap.api_key,
              ap.balance::float8 as balance, ap.balance_at, ap.sandbox
         from sales s join api_providers ap on ap.id = s.provider_id
        where s.id = $1`,
      [row.id]
    )
    if (!provider || !supportsAuto(provider.kind)) continue

    try {
      const result = await adapterFor(provider.kind).checkOrder(toConfig(provider), {
        ref: row.provider_ref,
        orderId: row.provider_order_id,
        productType: row.provider_product_type,
      })
      // ปลายทางหาไม่เจอทั้งที่เราส่งไปแล้ว — อาจยังไม่ขึ้นระบบ อย่าเพิ่งด่วนสรุป
      // แค่เลื่อนเวลาเช็กออกไป รอบหน้าค่อยถามใหม่
      // ปลายทางหาไม่เจอ / ตรวจสอบไม่ได้ — อาจยังไม่ขึ้นระบบ อย่าเพิ่งด่วนสรุป
      // แค่เลื่อนเวลาเช็กออกไป รอบหน้าค่อยถามใหม่
      if (result.state === 'missing' || result.state === 'unknown') {
        await q('update sales set provider_checked_at = now() where id = $1', [row.id])
        continue
      }
      await applyCheck(row.id, result)
      changed++
    } catch {
      // ปลายทางไม่ตอบรอบนี้ — เลื่อนเวลาเช็กแล้วไปต่อ ไม่ทำให้หน้าเว็บพัง
      await q('update sales set provider_checked_at = now() where id = $1', [row.id])
    }
  }

  // ② ส่งออเดอร์ที่ยังค้างอยู่ในคิว (เช่นตอนสั่งซื้อยิงไม่ผ่าน หรือเพิ่งเปิดสวิตช์อัตโนมัติ)
  if (await autoDispatchOn()) {
    const queued = await q<{ id: number }>(
      `select id from sales
        where provider_state = 'queued' and status <> 'cancelled'
          and provider_attempts < $1
        order by sold_at
        limit $2`,
      [MAX_ATTEMPTS, BATCH]
    )
    for (const row of queued) {
      if (outOfTime()) return changed
      await dispatchSale(row.id)
      changed++
    }
  }

  return changed
}
