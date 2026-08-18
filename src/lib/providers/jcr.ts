import 'server-only'
import { JCR_DEFAULT_BASE } from './constants'
import {
  ProviderError,
  type CatalogEntry,
  type ProviderAdapter,
  type ProviderConfig,
  type ProviderField,
} from './types'

/**
 * ตัวเชื่อมต่อ JCR-SHOP Reseller API (v1)
 * เอกสาร: Postman collection "JCR-SHOP Reseller API"
 * คีย์ขึ้นต้นด้วย jcr_rk_ ส่งแบบ Bearer token — ขอคีย์ได้จากทีมงาน JCR
 *
 * จุดที่ต่างจากเจ้าอื่นและต้องระวัง:
 *  - รายการแพ็กเกจต้องยิงทีละสินค้า (/products แล้วต่อด้วย /products/:id/packages)
 *    ดึงรายการทั้งหมดจึงยิงหลายครั้ง ต้องคุมจำนวนที่ยิงพร้อมกันและมีเวลาจำกัด
 *  - สั่งซื้อส่งเป็น multipart/form-data ช่อง items เป็นข้อความ JSON (สั่งได้หลายชิ้นในครั้งเดียว)
 *    ระบบเราสั่งทีละบิลอยู่แล้ว จึงส่งไปหนึ่งชิ้นเสมอ
 *  - แพ็กเกจแบบ "ระบุจำนวนเอง" (dynamic) ต้องขอราคาที่ /quote ก่อน แล้วแนบ quoteId ไปตอนสั่ง
 *  - externalRef คือเลขอ้างอิงของเรา ใช้ตามออเดอร์กลับได้เมื่อยิงไปแล้วขาดการติดต่อ
 *
 * ⚠️ เอกสารที่ได้มาบอกแค่ "ยิงยังไง" ไม่ได้บอกว่า "ตอบกลับหน้าตาแบบไหน"
 * โค้ดนี้จึงอ่านค่าแบบยืดหยุ่น (รองรับทั้งห่อด้วย data และส่งมาตรง ๆ / ชื่อคีย์หลายแบบ)
 * ถ้าปลายทางใช้ชื่อคีย์ที่ยังไม่ครอบคลุม ให้เพิ่มชื่อในรายการ pick* ด้านล่างได้เลย
 */

/** ที่อยู่ API ทุกเส้นขึ้นต้นด้วยนี้ */
const API_PREFIX = 'api/reseller/v1'

const TIMEOUT_MS = 20_000

/** ตามออเดอร์ด้วยเลขอ้างอิงของเรา — ไล่ดูรายการล่าสุดกี่หน้า หน้าละกี่รายการ */
const LIST_LIMIT = 50
const LIST_MAX_PAGES = 4

/**
 * ดึงรายการสินค้า — ยิงพร้อมกันได้กี่เส้น และให้เวลาทั้งหมดเท่าไร (Vercel ตัดที่ 60 วินาที)
 * ยิงพร้อมกันเยอะเกินไปจะโดนปลายทางกันไว้ (rate limit) แล้วได้ของมาไม่ครบ
 * 4 เส้นพร้อมกัน + ลองใหม่เมื่อโดนกัน ได้ครบกว่ายิงรัว ๆ 6 เส้นแล้วพลาดครึ่งหนึ่ง
 */
const CATALOG_CONCURRENCY = 4
const CATALOG_BUDGET_MS = 45_000

/** ลองใหม่กี่ครั้งเมื่อเส้นนั้นพลาดแบบที่ลองใหม่แล้วมีโอกาสสำเร็จ */
const CATALOG_RETRIES = 3

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type Json = Record<string, unknown>

/** รหัสข้อผิดพลาดที่ลองใหม่แล้วมีโอกาสสำเร็จ */
const RETRYABLE = new Set([
  'rate_limited',
  'rate_limit_exceeded',
  'too_many_requests',
  'internal_error',
  'server_error',
  'service_unavailable',
])

/** คำอธิบายภาษาคนสำหรับรหัสที่เจอบ่อย เพื่อให้คนหลังร้านแก้เองได้โดยไม่ต้องเปิดเอกสาร */
const ERROR_HINT: Record<string, string> = {
  missing_api_key: 'ยังไม่ได้ใส่คีย์ของ JCR — ไปตั้งที่หน้าจัดการเว็บไซต์ > ผู้ให้บริการ',
  invalid_api_key_format: 'รูปแบบคีย์ไม่ถูกต้อง — คีย์ของ JCR ต้องขึ้นต้นด้วย jcr_rk_',
  invalid_api_key: 'คีย์ไม่ถูกต้องหรือถูกยกเลิกแล้ว — ขอคีย์ใหม่จากทีมงาน JCR',
  forbidden: 'คีย์นี้ยังไม่ได้รับสิทธิ์ใช้งาน API — ติดต่อทีมงาน JCR เพื่อเปิดสิทธิ์',
  insufficient_balance: 'ยอดเงินของร้านที่ JCR ไม่พอ — เติมเงินเข้าบัญชี JCR ก่อน',
  out_of_stock: 'สินค้าหมดที่ฝั่ง JCR',
  product_not_found: 'ไม่พบสินค้านี้ที่ JCR — กดดึงรายการใหม่แล้วนำเข้าอีกครั้ง',
  package_not_found: 'ไม่พบแพ็กเกจนี้ที่ JCR — กดดึงรายการใหม่แล้วนำเข้าอีกครั้ง',
  order_not_found: 'ไม่พบออเดอร์นี้ที่ JCR',
  duplicate_external_ref:
    'เลขอ้างอิงนี้เคยส่งไปแล้ว = ออเดอร์เข้าระบบ JCR ไปก่อนหน้านี้ ระบบจะไม่สั่งซ้ำ ให้กดตามสถานะแทน',
  quote_expired: 'ใบเสนอราคาหมดอายุก่อนสั่งซื้อ — ระบบจะขอราคาใหม่ให้ในรอบถัดไป',
  invalid_quote: 'ใบเสนอราคาใช้ไม่ได้ — ระบบจะขอราคาใหม่ให้ในรอบถัดไป',
  validation_error: 'ข้อมูลที่ส่งไปไม่ครบหรือผิดรูปแบบ — ตรวจช่องที่ลูกค้ากรอกกับรหัสแพ็กเกจ',
  rate_limited: 'ยิงถี่เกินไป ระบบจะลองใหม่ให้เอง',
  http_429: 'ปลายทางกันไว้เพราะยิงถี่เกินไป ระบบจะลองใหม่ให้เอง',
  http_404: 'ปลายทางไม่มีเส้นทางนี้ หรือสินค้าตัวนี้ถูกปิดอยู่',
  http_403: 'คีย์นี้ไม่มีสิทธิ์เข้าถึงรายการนี้ — ติดต่อทีมงาน JCR',
}

/** ที่อยู่เต็มของเส้น API — รองรับกรณีมีคนใส่ base_url มาพร้อม /api/reseller/v1 แล้ว */
function endpoint(baseUrl: string | null | undefined, path: string) {
  const root = (baseUrl || JCR_DEFAULT_BASE)
    .replace(/\/+$/, '')
    .replace(new RegExp(`/${API_PREFIX}$`, 'i'), '')
  return `${root}/${API_PREFIX}/${path.replace(/^\/+/, '')}`
}

/**
 * เรียก API — ใส่ Bearer token ให้ทุกครั้ง และแปลง error ของ JCR เป็นชนิดกลาง
 * รูปแบบข้อผิดพลาดของเจ้านี้คือ { "error": "รหัส", "message": "คำอธิบาย" }
 */
async function api(
  config: ProviderConfig,
  path: string,
  init?: { method?: 'GET' | 'POST'; json?: unknown; form?: FormData }
): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(endpoint(config.baseUrl, path), {
      method: init?.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${config.secret}`,
        Accept: 'application/json',
        // multipart ห้ามตั้ง Content-Type เอง ต้องปล่อยให้ fetch ใส่ boundary ให้
        ...(init?.json ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init?.form ?? (init?.json ? JSON.stringify(init.json) : undefined),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new ProviderError(
      /timeout|abort/i.test(reason)
        ? `ต่อ JCR ไม่ได้ภายใน ${TIMEOUT_MS / 1000} วินาที (ปลายทางไม่ตอบ)`
        : `ต่อ JCR ไม่ได้: ${reason}`,
      true
    )
  }

  const text = await res.text()
  let data: unknown = null
  if (text.trim()) {
    try {
      data = JSON.parse(text)
    } catch {
      throw new ProviderError(
        `JCR ตอบกลับไม่ใช่ JSON (HTTP ${res.status}) — ${text.slice(0, 120)}`,
        res.status >= 500
      )
    }
  }

  const body = (data ?? {}) as { error?: string; message?: string }
  if (!res.ok || body.error) {
    const code = (body.error || `http_${res.status}`).toLowerCase()
    const parts = [ERROR_HINT[code], body.message && `ปลายทางแจ้ง: ${body.message}`]
    const detail = parts.filter(Boolean).join(' · ')
    throw new ProviderError(
      detail ? `${detail} (${code})` : `JCR แจ้งข้อผิดพลาด: ${code}`,
      // 429 = โดนกันเพราะยิงถี่ ลองใหม่ทีหลังได้เสมอ แม้ปลายทางจะไม่ได้ส่งรหัสมาให้
      RETRYABLE.has(code) || res.status >= 500 || res.status === 429
    )
  }

  return data
}

/** ปลายทางไม่รู้จักสิ่งที่ถาม (ใช้แยกว่า "ออเดอร์ไม่เคยเข้าไป" ออกจากข้อผิดพลาดอื่น) */
function isNotFound(err: unknown) {
  return err instanceof ProviderError && /\((order_not_found|http_404)\)/.test(err.message)
}

/** ปอกเปลือกที่ห่อค่ามา — บางเส้นห่อด้วย data บางเส้นส่งมาตรง ๆ */
function unwrap(body: unknown, ...keys: string[]): unknown {
  let cur = body
  for (let depth = 0; depth < 4; depth++) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return cur
    const obj = cur as Json
    const hit = ['data', ...keys].find((k) => obj[k] !== undefined)
    if (!hit) return cur
    cur = obj[hit]
  }
  return cur
}

/** ดึงรายการออกมาไม่ว่าปลายทางจะห่อด้วยชื่อไหน */
function asArray(body: unknown, ...keys: string[]): Json[] {
  const value = unwrap(body, ...keys, 'items', 'results', 'rows', 'list')
  return Array.isArray(value) ? value.filter((v): v is Json => !!v && typeof v === 'object') : []
}

function pickString(source: unknown, keys: string[]): string | null {
  if (!source || typeof source !== 'object') return null
  const obj = source as Json
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    if (typeof value === 'number') return String(value)
  }
  return null
}

function pickNumber(source: unknown, keys: string[]): number | null {
  if (typeof source === 'number') return Number.isFinite(source) ? source : null
  if (!source || typeof source !== 'object') return null
  const obj = source as Json
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() !== '') {
      // ปลายทางอาจส่งมาเป็นข้อความพร้อมจุลภาค เช่น "1,250.00"
      const n = Number(value.replace(/,/g, ''))
      if (Number.isFinite(n)) return n
    }
  }
  return null
}

/** ชื่อคีย์ราคาที่ผู้ให้บริการนิยมใช้ — ต้องเดาเผื่อไว้เพราะเอกสารไม่มีตัวอย่างคำตอบ */
const PRICE_KEYS = [
  'price',
  'resellerPrice',
  'reseller_price',
  'agentPrice',
  'agent_price',
  'salePrice',
  'sale_price',
  'netPrice',
  'net_price',
  'basePrice',
  'base_price',
  'price_baht',
  'cost',
  'amount',
  'unitPrice',
  'unit_price',
]

/**
 * ราคาทุนของแพ็กเกจหนึ่ง
 * บางเจ้าห่อราคาไว้ในก้อน เช่น price: { amount: 51, currency: 'THB' } จึงต้องเปิดดูข้างในด้วย
 */
function packPrice(pack: Json): number | null {
  const direct = pickNumber(pack, PRICE_KEYS)
  if (direct !== null) return direct
  for (const key of PRICE_KEYS) {
    const nested = pack[key]
    if (nested && typeof nested === 'object') {
      const inner = pickNumber(nested, ['amount', 'value', 'thb', 'baht', ...PRICE_KEYS])
      if (inner !== null) return inner
    }
  }
  return null
}

/**
 * ช่องที่ลูกค้าต้องกรอกของสินค้านั้น (uid / เซิร์ฟเวอร์ / ภูมิภาค ฯลฯ)
 * ชื่อคีย์ต้องตรงกับที่ JCR ใช้ เพราะจะถูกส่งกลับไปเป็น userInput ตอนสั่งซื้อ
 */
function parseFields(source: unknown): ProviderField[] {
  const raw = Array.isArray(source) ? source : []
  const out: ProviderField[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const field = item as Json

    const key = pickString(field, ['key', 'name', 'field', 'id', 'form_name'])
    if (!key) continue

    const rawOptions =
      ['options', 'option', 'choices', 'values']
        .map((k) => field[k])
        .find((v): v is unknown[] => Array.isArray(v)) ?? []

    const options = rawOptions
      .map((opt) => {
        if (typeof opt === 'string') return { value: opt, label: opt }
        const value = pickString(opt, ['value', 'id', 'key', 'code'])
        if (!value) return null
        return { value, label: pickString(opt, ['label', 'name', 'title', 'text']) ?? value }
      })
      .filter((o): o is { value: string; label: string } => o !== null)

    out.push({
      key,
      label: pickString(field, ['label', 'title', 'name', 'placeholder']) ?? key,
      options: options.length > 0 ? options : undefined,
    })
  }
  return out
}

/** แพ็กเกจแบบ "ระบุจำนวนเอง" ต้องขอราคาก่อนสั่ง จึงต้องแยกให้ออกตั้งแต่ตอนดึงรายการ */
function isDynamic(pack: Json, product: Json): boolean {
  for (const flag of [pack.dynamic, pack.isDynamic, pack.is_dynamic, product.dynamic]) {
    if (typeof flag === 'boolean') return flag
  }
  const type = (
    pickString(pack, ['type', 'packageType', 'package_type', 'mode', 'kind']) ?? ''
  ).toLowerCase()
  return type === 'dynamic'
}

/** ข้อมูลออเดอร์หนึ่งใบจากผลลัพธ์ที่ปลายทางส่งกลับมา (เราสั่งทีละใบ จึงหยิบใบแรกพอ) */
function orderRecord(body: unknown): Json | null {
  const value = unwrap(body, 'order', 'orders')
  const record = Array.isArray(value) ? value[0] : value
  return record && typeof record === 'object' ? (record as Json) : null
}

function orderIdOf(record: Json | null): string | null {
  if (!record) return null
  const direct = pickString(record, ['orderId', 'order_id', 'id', 'code', 'orderCode'])
  if (direct) return direct
  // ออเดอร์แบบหลายชิ้นอาจใส่เลขไว้ที่รายการย่อยแทน
  const items = asArray(record, 'orders')
  return items.length > 0 ? pickString(items[0], ['orderId', 'order_id', 'id']) : null
}

function refOf(record: Json): string | null {
  return pickString(record, [
    'externalRef',
    'external_ref',
    'externalReference',
    'reference',
    'referenceId',
    'reference_id',
    'ref',
  ])
}

/**
 * แปลงสถานะของ JCR เป็นสถานะกลางของระบบเรา
 *
 * เอกสารไม่ได้ระบุรายการสถานะไว้ จึงรับคำที่ผู้ให้บริการเติมเกมใช้กันทั่วไปให้ครบ
 * และ **ถือว่า "ยังไม่จบ" สำหรับคำที่ไม่รู้จัก** — ปลอดภัยกว่าเดาว่าสำเร็จหรือล้มเหลว
 * เพราะเดาว่าล้มเหลว = คืนเครดิตลูกค้าทั้งที่ของอาจเข้าเกมไปแล้ว
 */
export function mapStatus(record: Json, fallbackId: string | null) {
  const items = asArray(record, 'orders')
  const status = (
    pickString(record, ['status', 'state', 'orderStatus', 'order_status']) ??
    (items.length > 0 ? pickString(items[0], ['status', 'state']) : null) ??
    ''
  ).toLowerCase()

  const note =
    pickString(record, ['message', 'note', 'detail', 'statusText', 'status_text', 'remark']) ?? ''
  const detail = note ? ` — ${note}` : ''
  const orderId = orderIdOf(record) ?? fallbackId

  if (
    ['success', 'successful', 'completed', 'complete', 'done', 'delivered', 'finished'].includes(
      status
    )
  ) {
    return { state: 'success' as const, message: `JCR เติมสำเร็จ${detail}`, orderId }
  }
  if (
    ['failed', 'fail', 'cancelled', 'canceled', 'rejected', 'refunded', 'expired', 'error'].includes(
      status
    )
  ) {
    // ปลายทางแจ้งว่าจบแบบไม่สำเร็จแน่นอน = ของไม่เข้า คืนเครดิตลูกค้าได้อย่างปลอดภัย
    return { state: 'failed' as const, message: `JCR แจ้งว่าไม่สำเร็จ${detail}`, orderId }
  }
  if (
    ['issue', 'problem', 'on_hold', 'onhold', 'hold', 'manual', 'review', 'partial'].includes(status)
  ) {
    // จบแล้วแต่สรุปไม่ได้ว่าของเข้าหรือไม่ — ต้องให้คนตรวจ ห้ามคืนเงินอัตโนมัติ
    return {
      state: 'attention' as const,
      message: `JCR แจ้งว่าติดปัญหา${detail} — ตรวจสอบก่อนคืนเครดิตให้ลูกค้า`,
      orderId,
    }
  }
  return {
    state: 'sent' as const,
    message: `JCR กำลังดำเนินการ${status ? ` (${status})` : ''}${detail}`,
    orderId,
  }
}

/** ขอราคาสำหรับแพ็กเกจแบบระบุจำนวนเอง — ต้องแนบ quoteId ที่ได้ไปตอนสั่งซื้อ */
async function createQuote(
  config: ProviderConfig,
  packageId: string,
  userInput: Record<string, string>
) {
  const body = await api(config, 'quote', { method: 'POST', json: { packageId, userInput } })
  const quote = unwrap(body, 'quote')
  const quoteId = pickString(quote, ['quoteId', 'quote_id', 'id', 'token'])
  if (!quoteId) {
    throw new ProviderError(
      'JCR ไม่ได้ส่ง quoteId กลับมา — แพ็กเกจแบบระบุจำนวนเองนี้สั่งอัตโนมัติไม่ได้ ให้กดเติมเองที่หน้าลงยอดขาย'
    )
  }
  return {
    quoteId,
    price: pickNumber(quote, ['total', 'totalPrice', 'total_price', 'price', 'amount', 'cost']),
  }
}

export const jcr: ProviderAdapter = {
  kind: 'jcr',

  async getBalance(config) {
    // ยิงพร้อมกันสองเส้น: ยอดเงิน กับ ชื่อบัญชี — ชื่อบัญชีไว้ยืนยันว่าต่อถูกร้าน
    // ถ้า /me พังก็ไม่เป็นไร ยอดเงินสำคัญกว่า
    const [balanceRes, meRes] = await Promise.allSettled([
      api(config, 'balance'),
      api(config, 'me'),
    ])
    if (balanceRes.status === 'rejected') throw balanceRes.reason

    const data = unwrap(balanceRes.value, 'balance', 'wallet')
    const balance =
      typeof data === 'number'
        ? data
        : pickNumber(data, ['balance', 'amount', 'credit', 'available', 'current', 'wallet'])

    if (balance === null) {
      throw new ProviderError('อ่านยอดเงินจากคำตอบของ JCR ไม่ได้ — รูปแบบคำตอบอาจเปลี่ยนไป')
    }

    const me = meRes.status === 'fulfilled' ? unwrap(meRes.value, 'user', 'reseller') : null
    return {
      balance,
      unit: 'บาท',
      account: pickString(me, ['name', 'username', 'shopName', 'shop_name', 'email']),
    }
  },

  async placeOrder(config, input) {
    const packageId = input.sku?.trim()
    if (!packageId) {
      throw new ProviderError('แพ็กเกจนี้ยังไม่ได้จับคู่รหัสแพ็กเกจของ JCR — ไปตั้งที่หน้าแพ็กเกจก่อน')
    }

    // ค่าที่ลูกค้ากรอกต้องส่งไปให้ครบตามช่องที่ JCR กำหนด
    // ส่งไม่ครบ = ออเดอร์ถูกปฏิเสธ หรือแย่กว่านั้นคือเติมเข้าผิดเซิร์ฟเวอร์
    const userInput: Record<string, string> = {}
    for (const [key, value] of Object.entries(input.fields ?? {})) {
      const text = String(value ?? '').trim()
      if (text) userInput[key] = text
    }
    // แพ็กเกจที่ไม่ได้กำหนดช่องอะไรไว้เลย ใช้ไอดีเกมที่ลูกค้ากรอกเป็น uid ตามค่ามาตรฐาน
    if (Object.keys(userInput).length === 0) userInput.uid = input.account

    const item: Json = { packageId, quantity: input.quantity, userInput }

    if ((input.productType ?? '').toLowerCase() === 'dynamic') {
      const quote = await createQuote(config, packageId, userInput)
      // ราคาที่ปลายทางคิดจริงต้องไม่แพงกว่าทุนที่บันทึกไว้ตอนขาย ไม่งั้นขายขาดทุนเงียบ ๆ
      // (ตอนนี้แค่ขอราคา ยังไม่ได้สั่งซื้อ จึงหยุดได้อย่างปลอดภัย)
      const budget =
        typeof input.unitPrice === 'number' && input.unitPrice > 0
          ? input.unitPrice * input.quantity
          : null
      if (quote.price !== null && budget !== null && quote.price > budget + 0.01) {
        throw new ProviderError(
          `JCR คิดราคา ${quote.price.toLocaleString('th-TH')} บาท ` +
            `แต่ทุนที่ระบบบันทึกไว้คือ ${budget.toLocaleString('th-TH')} บาท — ` +
            `ยังไม่ได้สั่งซื้อ ให้กดดึงรายการใหม่เพื่ออัปเดตราคาทุนก่อน (กันขายขาดทุน)`
        )
      }
      item.quoteId = quote.quoteId
    }

    // เส้นสั่งซื้อรับเป็น multipart/form-data — items เป็นข้อความ JSON หนึ่งช่อง
    const form = new FormData()
    form.append('items', JSON.stringify([item]))
    form.append('externalRef', input.ref)

    const body = await api(config, 'orders', { method: 'POST', form })
    const record = orderRecord(body)
    const orderId = orderIdOf(record)

    if (!orderId) {
      // ปลายทางรับไปแล้วแต่เราไม่รู้เลขออเดอร์ — ห้ามสั่งซ้ำเด็ดขาด
      // เครื่องยนต์จะพักบิลไว้ให้คนตรวจ และยังตามด้วย externalRef ได้อยู่
      throw new ProviderError(
        'JCR ไม่ได้ส่งเลขออเดอร์กลับมา — ห้ามสั่งซ้ำ ให้กดตามสถานะหรือตรวจที่หน้าเว็บ JCR ก่อน'
      )
    }

    const status = pickString(record, ['status', 'state'])
    return { orderId, message: `JCR รับออเดอร์แล้ว (${status ?? 'pending'})` }
  },

  async checkOrder(config, order) {
    // รู้เลขออเดอร์แล้วถามตรง ๆ ได้เลย
    if (order.orderId) {
      try {
        const record = orderRecord(await api(config, `orders/${encodeURIComponent(order.orderId)}`))
        if (!record) {
          return { state: 'unknown', message: 'JCR ตอบกลับโดยไม่มีข้อมูลออเดอร์ — ตรวจสอบเองก่อน' }
        }
        return mapStatus(record, order.orderId)
      } catch (err) {
        // ปลายทางไม่รู้จักออเดอร์นี้ = คำสั่งไม่เคยเข้าไป ส่งใหม่ได้อย่างปลอดภัย
        if (isNotFound(err)) return { state: 'missing', message: 'JCR ไม่พบออเดอร์นี้' }
        throw err
      }
    }

    // ยังไม่รู้เลขออเดอร์ (ยิงไปแล้วขาดการติดต่อ) — ไล่หาจากรายการล่าสุดด้วยเลขอ้างอิงของเรา
    let reachedEnd = false
    for (let page = 1; page <= LIST_MAX_PAGES; page++) {
      const list = asArray(await api(config, `orders?page=${page}&limit=${LIST_LIMIT}`), 'orders')
      const found = list.find((row) => refOf(row) === order.ref)
      if (found) return mapStatus(found, null)
      if (list.length < LIST_LIMIT) {
        reachedEnd = true
        break
      }
    }

    // ดูจนหมดรายการแล้วไม่เจอ = ออเดอร์ไม่เคยเข้าไปจริง ๆ ส่งใหม่ได้
    if (reachedEnd) {
      return { state: 'missing', message: 'JCR ไม่พบออเดอร์ที่ใช้เลขอ้างอิงนี้' }
    }
    // ยังดูไม่ทั่ว — สรุปไม่ได้ ห้ามส่งใหม่เพราะอาจกลายเป็นเติมสองรอบ
    return {
      state: 'unknown',
      message:
        `ไล่หาในออเดอร์ล่าสุด ${LIST_MAX_PAGES * LIST_LIMIT} รายการของ JCR แล้วไม่เจอเลขอ้างอิงนี้ ` +
        `แต่ยังดูไม่หมด — ห้ามสั่งซ้ำ ให้เช็กที่หน้าเว็บ JCR ก่อน`,
    }
  },

  /**
   * ดึงรายการสินค้าทั้งหมด
   * เจ้านี้ต้องยิงถามแพ็กเกจทีละสินค้า จึงยิงพร้อมกันทีละหลายเส้นและมีเวลาจำกัด
   *
   * สินค้าที่ดึงไม่ครบจะถูกนับไว้แล้วรายงานกลับไปให้คนกดเห็น ไม่เงียบหาย
   * เพราะ "ได้ไม่ครบแต่ไม่มีใครรู้" อันตรายกว่า "ดึงไม่สำเร็จ" — คนจะไปตามหาแพ็กเกจที่ไม่มีวันเจอ
   *
   * หมายเหตุเรื่องเกมที่มีหลายโปรโมชั่น (เช่น Lineage2M):
   * ฝั่ง JCR แยกเป็นคนละสินค้า (คนละ productId) แต่ใช้ชื่อเดียวกัน
   * ที่นี่จึงได้มาหลายชุดชื่อซ้ำกัน ซึ่งถูกแล้ว — ต้องนำเข้าให้ครบทุกชุดถึงจะได้แพ็กเกจครบ
   */
  async fetchCatalog(config) {
    const products = asArray(await api(config, 'products'), 'products')
    if (products.length === 0) {
      throw new ProviderError('JCR ไม่ได้ส่งรายการสินค้ามาเลย — ตรวจสอบสิทธิ์ของคีย์กับทีมงาน JCR')
    }

    const out: CatalogEntry[] = []
    const deadline = Date.now() + CATALOG_BUDGET_MS
    let cursor = 0
    /** แพ็กเกจที่ปลายทางไม่บอกราคา — ข้ามไปเพราะตั้งราคาขายให้ไม่ได้ */
    let noPrice = 0
    /** เหตุผลที่สินค้าแต่ละตัวดึงไม่สำเร็จ — เก็บไว้รายงาน ไม่ใช่แค่นับจำนวน */
    const failures: string[] = []

    /**
     * ถามแพ็กเกจของสินค้าหนึ่ง พร้อมลองใหม่เมื่อโดนปลายทางกัน
     * ตอนดึงทั้งร้านจะยิงเป็นร้อยเส้นรวด ผู้ให้บริการมักกันไว้ชั่วคราว
     * ถ้ายอมแพ้ตั้งแต่ครั้งแรก จะได้ของมาไม่ครบทั้งที่ปลายทางไม่ได้เสียอะไรเลย
     */
    const packagesOf = async (productId: string): Promise<Json[]> => {
      for (let attempt = 1; ; attempt++) {
        try {
          return asArray(
            await api(config, `products/${encodeURIComponent(productId)}/packages`),
            'packages'
          )
        } catch (err) {
          const canRetry = err instanceof ProviderError && err.retryable
          if (!canRetry || attempt >= CATALOG_RETRIES || Date.now() > deadline) throw err
          // ถอยห่างขึ้นเรื่อย ๆ ให้ปลายทางได้พัก
          await sleep(400 * attempt)
        }
      }
    }

    const worker = async () => {
      while (cursor < products.length && Date.now() < deadline) {
        const product = products[cursor++]
        const productId = pickString(product, ['id', 'productId', 'product_id', 'code'])
        const productName = pickString(product, ['name', 'title', 'productName'])
        if (!productId || !productName) continue

        let packages: Json[]
        try {
          packages = await packagesOf(productId)
        } catch (err) {
          // สินค้าตัวนี้ดึงไม่ได้ (เช่นถูกปิดอยู่) — ข้ามไป อย่าให้ทั้งรายการพัง
          // แต่ต้องจำเหตุผลไว้ ไม่งั้นคนกดจะไม่มีทางรู้ว่าทำไมของหาย
          failures.push(err instanceof Error ? err.message : String(err))
          continue
        }

        // ช่องที่ต้องกรอกมักผูกกับตัวสินค้า แต่บางแพ็กเกจอาจกำหนดเพิ่มเอง
        const productFields = parseFields(product.fields ?? product.userInput ?? product.inputs)

        for (const pack of packages) {
          const packageId = pickString(pack, ['id', 'packageId', 'package_id', 'code'])
          if (!packageId) continue

          const price = packPrice(pack)
          // ราคาทุนต้องรู้ก่อนถึงจะตั้งราคาขายอัตโนมัติได้
          // แพ็กเกจที่ปลายทางไม่บอกราคา (หรือราคา 0) ข้ามไป ไม่งั้นจะกลายเป็นสินค้าราคา 0 บนหน้าเว็บ
          if (price === null || price <= 0) {
            noPrice++
            continue
          }

          const packFields = parseFields(pack.fields ?? pack.userInput ?? pack.inputs)
          const fields = packFields.length > 0 ? packFields : productFields
          const dynamic = isDynamic(pack, product)

          out.push({
            gameId: productId,
            gameName: productName,
            // JCR ไม่ได้แยกเซิร์ฟเวอร์เป็นชั้นต่างหาก ถ้ามีจะอยู่ในช่องที่ลูกค้าเลือกเอง
            serverId: '0',
            serverName: null,
            sku: packageId,
            packName: pickString(pack, ['name', 'title', 'packageName']) ?? packageId,
            packDesc:
              (pickString(pack, ['description', 'detail', 'desc', 'note']) ?? '') +
              (dynamic ? ' (ระบุจำนวนเอง — ราคาต่อหน่วย)' : ''),
            price,
            productType: dynamic ? 'dynamic' : 'fixed',
            fields: fields.length > 0 ? fields : null,
          })
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(CATALOG_CONCURRENCY, products.length) }, worker)
    )

    if (out.length === 0) {
      throw new ProviderError(
        'ดึงรายการจาก JCR ได้ แต่ไม่มีแพ็กเกจที่ระบุราคาไว้เลย — ตรวจสอบสิทธิ์ราคาตัวแทนกับทีมงาน JCR'
      )
    }

    // สิ่งที่ยังไม่ได้ดึงมา ต้องบอกให้รู้ ไม่ใช่ปล่อยให้เข้าใจว่าครบ
    const left = products.length - cursor
    // เหตุผลที่เจอบ่อยที่สุด — บอกไปด้วยจะได้รู้ว่าต้องแก้ที่ไหน (โดนกัน / คีย์ / สินค้าปิด)
    const tally = new Map<string, number>()
    for (const reason of failures) tally.set(reason, (tally.get(reason) ?? 0) + 1)
    const topReason = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

    const warnings = [
      left > 0
        ? `ดึงไม่ทัน ${left} สินค้า (หมดเวลา ${CATALOG_BUDGET_MS / 1000} วินาที) — กดดึงซ้ำอีกครั้ง`
        : null,
      failures.length > 0
        ? `${failures.length} สินค้าที่ดึงแพ็กเกจไม่สำเร็จ` +
          (topReason ? ` — ส่วนใหญ่เพราะ: ${topReason.slice(0, 160)}` : '')
        : null,
      noPrice > 0 ? `ข้าม ${noPrice} แพ็กเกจที่ JCR ไม่ได้บอกราคา` : null,
    ].filter(Boolean)

    return { entries: out, note: warnings.length > 0 ? warnings.join(' · ') : null }
  },
}
