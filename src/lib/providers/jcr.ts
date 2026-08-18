import 'server-only'
import { JCR_DEFAULT_BASE } from './constants'
import { INTERACTIVE_MAX_WAIT_MS, OutOfTime, limited, pacerFor, retryAfterMs } from './http'
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
 * เขียนตามเอกสาร API ฉบับเต็มของ JCR แล้ว (ไม่ใช่การเดาจาก Postman collection อีกต่อไป)
 * ยังอ่านค่าแบบยืดหยุ่นไว้เผื่อเขาปรับชื่อคีย์ในอนาคต — เพิ่มชื่อในรายการ pick* ได้เลย
 *
 * เพดานการยิงตามเอกสาร: อ่าน (GET) 120 ครั้ง/นาที · เขียน (POST) 60 ครั้ง/นาที
 * เกินแล้วได้ 429 พร้อม Retry-After
 */

/** ที่อยู่ API ทุกเส้นขึ้นต้นด้วยนี้ */
const API_PREFIX = 'api/reseller/v1'

const TIMEOUT_MS = 20_000

/** ตามออเดอร์ด้วยเลขอ้างอิงของเรา — ไล่ดูรายการล่าสุดกี่หน้า หน้าละกี่รายการ */
const LIST_LIMIT = 50
const LIST_MAX_PAGES = 4

/**
 * ดึงรายการสินค้า — ยิงพร้อมกันได้กี่เส้น และให้เวลาทั้งหมดเท่าไร (Vercel ตัดที่ 60 วินาที)
 *
 * JCR กันการยิงถี่ไว้ (ตอบ rate_limit_exceeded พร้อมบอกเวลาที่ต้องรอใน Retry-After)
 * จึงไม่ยิงรัวแล้วค่อยแก้ตอนโดนกัน แต่เว้นจังหวะให้พอดีตั้งแต่แรก
 * เร็วกว่าเพราะไม่ต้องเสียเที่ยวยิงทิ้ง และไม่ทำให้ปลายทางเดือดร้อน
 */
const CATALOG_CONCURRENCY = 3
/**
 * งบเวลาทั้งหมดของการดึงหนึ่งรอบ
 * ต้องเผื่อให้ Vercel มีเวลาเหลือไปบันทึกลงฐานข้อมูลด้วย (เพดานทั้งฟังก์ชันคือ 60 วินาที)
 * ถ้าลากยาวจนโดนตัดกลางคัน หน้าเว็บจะขึ้น "An unexpected response was received from the server"
 * ซึ่งแย่กว่าดึงได้ไม่ครบ เพราะของที่ดึงมาได้แล้วก็ไม่ได้ถูกบันทึกด้วย
 */
const CATALOG_BUDGET_MS = 30_000

/**
 * เว้นระยะระหว่างการยิงแต่ละครั้งอย่างน้อยเท่านี้
 * เอกสารกำหนดเพดานอ่านไว้ 120 ครั้ง/นาที = 2 ครั้ง/วินาที
 * ตั้ง 520ms (~115 ครั้ง/นาที) เผื่อขอบไว้นิดหน่อย จะได้ไม่ไปเบียดเพดานจนโดนกัน
 */
const CATALOG_GAP_MS = 520

/** ลองใหม่กี่ครั้งเมื่อเส้นนั้นพลาดแบบที่ลองใหม่แล้วมีโอกาสสำเร็จ */
const CATALOG_RETRIES = 3

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
  rate_limit_exceeded: 'ยิงถี่เกินเพดานของ JCR (อ่าน 120 ครั้ง/นาที) ระบบจะรอตามที่เขาบอกแล้วลองใหม่',
  http_429: 'ปลายทางกันไว้เพราะยิงถี่เกินไป ระบบจะลองใหม่ให้เอง',
  // รหัสตามเอกสารฉบับเต็ม — เขียนให้คนหลังร้านรู้ว่าต้องไปทำอะไรต่อ
  api_key_expired: 'คีย์หมดอายุแล้ว — ออกคีย์ใหม่ที่ Reseller Portal > API Keys',
  reseller_not_active: 'บัญชีตัวแทนถูกระงับอยู่ — ติดต่อทีมงาน JCR',
  reseller_deleted: 'บัญชีตัวแทนถูกลบแล้ว — ติดต่อทีมงาน JCR',
  ip_not_allowed:
    'ไอพีของเซิร์ฟเวอร์เราไม่อยู่ในรายการที่อนุญาต — ปิดการจำกัดไอพี หรือเพิ่มไอพีของ Vercel ' +
    'ที่ JCR > Settings > IP restrictions',
  ip_blocked: 'ไอพีถูกบล็อกชั่วคราวเพราะยืนยันตัวตนผิดหลายครั้ง — รอสักครู่แล้วลองใหม่',
  ip_permanently_blocked: 'ไอพีถูกบล็อกถาวร — ติดต่อทีมงาน JCR',
  insufficient_scope: 'คีย์นี้ไม่มีสิทธิ์เรียกเส้นนี้ — ขอเพิ่มสิทธิ์ (scope) กับทีมงาน JCR',
  insufficient_credit: 'เครดิตของร้านที่ JCR ไม่พอสำหรับยอดรวมของบิลนี้ — เติมเงินก่อน',
  stock_sold_out: 'แพ็กเกจนี้ของหมดที่ฝั่ง JCR',
  package_not_active: 'แพ็กเกจนี้ถูกปิดขายที่ JCR — กดดึงรายการใหม่',
  product_not_active: 'เกมนี้ถูกปิดขายที่ JCR — กดดึงรายการใหม่',
  provider_not_active: 'ผู้ให้บริการต้นทางของ JCR ปิดอยู่ — รอแล้วลองใหม่',
  package_max_exceeded: 'จำนวนที่สั่งเกินเพดานต่อออเดอร์ของแพ็กเกจนี้ — ให้ลูกค้าแยกสั่งทีละน้อยลง',
  invalid_user_input: 'ข้อมูลที่ลูกค้ากรอกไม่ตรงกับที่ JCR กำหนด — กดดึงรายการใหม่เพื่ออัปเดตช่องกรอก',
  quote_required: 'แพ็กเกจนี้ต้องขอราคาก่อนสั่ง — ระบบจะขอให้เองในรอบถัดไป',
  quote_not_found: 'ใบเสนอราคาไม่ถูกต้อง — ระบบจะขอใหม่ให้ในรอบถัดไป',
  quote_package_mismatch: 'ใบเสนอราคาไม่ตรงกับแพ็กเกจที่สั่ง — ระบบจะขอใหม่ให้ในรอบถัดไป',
  quote_input_mismatch: 'ใบเสนอราคาไม่ตรงกับข้อมูลที่ลูกค้ากรอก — ระบบจะขอใหม่ให้ในรอบถัดไป',
  package_not_dynamic: 'แพ็กเกจนี้เป็นราคาคงที่ ไม่ต้องขอราคาก่อน — กดดึงรายการใหม่เพื่ออัปเดตชนิด',
  compute_failed: 'สคริปต์คิดราคาของ JCR ทำงานผิดพลาด — แจ้งทีมงาน JCR',
  unsupported_content_type: 'ส่งข้อมูลผิดรูปแบบ (ต้องเป็น multipart/form-data) — เป็นบั๊กของระบบเรา',
  idempotency_in_progress: 'คำสั่งเดิมกำลังทำงานอยู่ — รอผลแล้วค่อยตามสถานะ ห้ามสั่งซ้ำ',
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
  init?: {
    method?: 'GET' | 'POST'
    json?: unknown
    form?: FormData
    timeoutMs?: number
    /**
     * กุญแจกันตัดเงินซ้ำ — เอกสาร JCR แนะนำให้ส่งทุกครั้งที่สั่งซื้อ
     * ยิงเส้นเดิมซ้ำด้วยกุญแจเดิมจะได้ผลลัพธ์เดิม ไม่กลายเป็นออเดอร์ใหม่
     */
    idempotencyKey?: string
    /** ขอเนื้อหาดิบ ไม่ต้องแปลงเป็น JSON (ใช้กับเส้นที่ตอบเป็น HTML) */
    raw?: boolean
  }
): Promise<unknown> {
  // ตอนดึงทั้งร้านจะบีบเวลาต่อเส้นให้สั้นลงตามเวลาที่เหลือ
  // ไม่งั้นเส้นสุดท้ายที่เริ่มตอนใกล้หมดเวลาจะลากยาวจนทั้งฟังก์ชันถูกตัด
  const timeout = Math.max(2_000, Math.min(TIMEOUT_MS, init?.timeoutMs ?? TIMEOUT_MS))
  let res: Response
  try {
    res = await fetch(endpoint(config.baseUrl, path), {
      method: init?.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${config.secret}`,
        Accept: 'application/json',
        // multipart ห้ามตั้ง Content-Type เอง ต้องปล่อยให้ fetch ใส่ boundary ให้
        ...(init?.json ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.idempotencyKey ? { 'Idempotency-Key': init.idempotencyKey } : {}),
      },
      body: init?.form ?? (init?.json ? JSON.stringify(init.json) : undefined),
      cache: 'no-store',
      signal: AbortSignal.timeout(timeout),
    })
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new ProviderError(
      /timeout|abort/i.test(reason)
        ? `ต่อ JCR ไม่ได้ภายใน ${Math.round(timeout / 1000)} วินาที (ปลายทางไม่ตอบ)`
        : `ต่อ JCR ไม่ได้: ${reason}`,
      true
    )
  }

  const text = await res.text()

  // เส้นที่ตอบเป็น HTML (แบบฟอร์มกรอกข้อมูลของลูกค้า) — คืนข้อความดิบไปให้ตัวแยกวิเคราะห์
  if (init?.raw) {
    if (!res.ok) {
      throw new ProviderError(
        `JCR ตอบ HTTP ${res.status} ตอนขอแบบฟอร์ม`,
        res.status >= 500 || res.status === 429,
        retryAfterMs(res.headers.get('retry-after'))
      )
    }
    return text
  }

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
      RETRYABLE.has(code) || res.status >= 500 || res.status === 429,
      retryAfterMs(res.headers.get('retry-after'))
    )
  }

  return data
}

/**
 * ตัวคุมจังหวะประจำร้านของเราที่ JCR
 * ใช้ตัวเดียวกันทั้งตอนดึงรายการและตอนสั่งออเดอร์ ไม่งั้นสองงานนี้จะแย่งโควตากันเอง
 */
function pacerOf(config: ProviderConfig) {
  return pacerFor(`jcr:${config.id}`, CATALOG_GAP_MS)
}

/**
 * เรียก API แบบที่มีคนรออยู่ (ลูกค้ากดซื้อ / พนักงานเปิดหน้าจอ)
 * เว้นจังหวะให้เหมือนกัน แต่ถ้าโดนกันแล้วต้องรอนาน ให้ยอมแพ้เร็ว ๆ
 * เครื่องยนต์ส่งออเดอร์จะเอาเข้าคิวส่งใหม่ให้เอง ดีกว่าปล่อยให้หน้าเว็บค้าง
 */
function callLive(config: ProviderConfig, path: string, init?: Parameters<typeof api>[2]) {
  return limited(pacerOf(config), () => api(config, path, init), {
    attempts: 2,
    maxWaitMs: INTERACTIVE_MAX_WAIT_MS,
  })
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
/**
 * ชนิดช่องกรอกที่ JCR ใช้: text, tel, number, select, image, password
 * ช่องแบบ image ต้องแนบไฟล์รูป (ส่งเป็น multipart แยกส่วน) ซึ่งหน้าเว็บลูกค้าเรายังไม่รองรับ
 * แพ็กเกจที่มีช่องแบบนี้จึงสั่งอัตโนมัติไม่ได้ ต้องคัดออกตั้งแต่ตอนดึงรายการ
 */
function needsFileUpload(fields: unknown): boolean {
  const raw = Array.isArray(fields) ? fields : []
  return raw.some(
    (f) => f && typeof f === 'object' && String((f as Json).type ?? '').toLowerCase() === 'image'
  )
}

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

/** อ่านค่าของแอตทริบิวต์หนึ่งจากข้อความแอตทริบิวต์ของแท็ก */
function attrOf(attrs: string, name: string): string | null {
  const quoted = attrs.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))
  if (quoted) return quoted[1].trim()
  const bare = attrs.match(new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, 'i'))
  return bare ? bare[1].trim() : null
}

/** แปลง HTML เป็นข้อความล้วน ๆ สำหรับใช้เป็นป้ายกำกับ */
function plainText(html: string) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

/** หาป้ายกำกับของช่องนั้น — เอา <label> ที่อยู่ใกล้ที่สุดก่อนหน้าช่อง */
function labelNear(html: string, index: number, attrs: string, key: string) {
  const before = html.slice(Math.max(0, index - 400), index)
  const labels = [...before.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/gi)]
  const last = labels.length > 0 ? plainText(labels[labels.length - 1][1]) : ''
  // ตัดเครื่องหมายบังคับกรอกกับทวิภาคท้ายป้ายออก ให้อ่านสะอาด
  const cleaned = last.replace(/[*:：]\s*$/, '').trim()
  return cleaned || attrOf(attrs, 'aria-label') || attrOf(attrs, 'placeholder') || key
}

/**
 * แปลงแบบฟอร์ม HTML ของ JCR เป็นช่องกรอกของหน้าเว็บเรา
 *
 * เจ้านี้ไม่ได้ส่งรายการช่องกรอกมาเป็น JSON แต่มีเส้น ?format=html ที่ส่งฟอร์มมาให้
 * ชื่อช่อง (name) ที่ได้จากฟอร์มคือคีย์เดียวกับที่ต้องส่งกลับไปใน userInput ตอนสั่งซื้อ
 * จึงเอามาใช้ตรง ๆ ได้ และหน้าเว็บลูกค้าจะได้ช่องกรอกตรงกับที่ JCR ต้องการเป๊ะ
 * (เช่น Lineage2M ต้องกรอก Role ID และเลือก Server ไม่ใช่แค่ UID ช่องเดียว)
 */
export function parseHtmlForm(html: string): ProviderField[] {
  // เก็บตำแหน่งในหน้าไว้ด้วย แล้วค่อยเรียงทีหลัง
  // ลูกค้าต้องเห็นช่องเรียงเหมือนหน้าเว็บของ JCR (Role ID ก่อน แล้วค่อย Server)
  // ไม่ใช่เรียงตามชนิดของช่องซึ่งไม่มีความหมายอะไรกับคนกรอก
  const found: Array<{ at: number; field: ProviderField }> = []
  const seen = new Set<string>()

  const push = (
    at: number,
    key: string,
    label: string,
    options?: Array<{ value: string; label: string }>
  ) => {
    if (!key || seen.has(key)) return
    seen.add(key)
    found.push({
      at,
      field: { key, label, options: options && options.length > 0 ? options : undefined },
    })
  }

  // ช่องแบบเลือกจากรายการ เช่น Server / Region — ต้องได้ตัวเลือกมาครบ ไม่งั้นลูกค้าพิมพ์มั่ว
  for (const m of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const [, attrs, inner] = m
    const key = attrOf(attrs, 'name')
    if (!key) continue
    const options = [...inner.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)]
      .map((o) => ({ value: attrOf(o[1], 'value') ?? '', label: plainText(o[2]) }))
      // ตัวเลือกว่างคือบรรทัด "กรุณาเลือก" ของเขา หน้าเว็บเราใส่ให้เองอยู่แล้ว
      .filter((o) => o.value !== '')
    push(m.index ?? 0, key, labelNear(html, m.index ?? 0, attrs, key), options)
  }

  // ช่องพิมพ์เอง เช่น Role ID / UID
  const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'file'])
  for (const m of html.matchAll(/<input\b([^>]*)>/gi)) {
    const attrs = m[1]
    const key = attrOf(attrs, 'name')
    const type = (attrOf(attrs, 'type') ?? 'text').toLowerCase()
    if (!key || SKIP_TYPES.has(type)) continue
    // จำนวนแพ็กเป็นของหน้าเว็บเราเอง ไม่ต้องให้ลูกค้ากรอกซ้ำ
    if (/^(qty|quantity|amount_pack|jumnuan)$/i.test(key)) continue
    push(m.index ?? 0, key, labelNear(html, m.index ?? 0, attrs, key))
  }

  for (const m of html.matchAll(/<textarea\b([^>]*)>/gi)) {
    const attrs = m[1]
    const key = attrOf(attrs, 'name')
    if (!key) continue
    push(m.index ?? 0, key, labelNear(html, m.index ?? 0, attrs, key))
  }

  return found.sort((a, b) => a.at - b.at).map((f) => f.field)
}

/** แพ็กเกจแบบ "ระบุจำนวนเอง" ต้องขอราคาก่อนสั่ง จึงต้องแยกให้ออกตั้งแต่ตอนดึงรายการ */
function isDynamic(pack: Json, product: Json): boolean {
  // เอกสาร: priceMode = "fixed" | "dynamic" และ requiresQuote บอกตรง ๆ ว่าต้องขอราคาก่อนไหม
  if (typeof pack.requiresQuote === 'boolean') return pack.requiresQuote
  const mode = (pickString(pack, ['priceMode', 'price_mode']) ?? '').toLowerCase()
  if (mode) return mode === 'dynamic'

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
    [
      // เอกสาร: คืนเงินบางส่วน = บางชิ้นเข้า บางชิ้นไม่เข้า ต้องให้คนดูว่าจะคืนลูกค้าเท่าไร
      'partially_refunded',
      'issue',
      'problem',
      'on_hold',
      'onhold',
      'hold',
      'manual',
      'review',
      'partial',
    ].includes(status)
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
  const body = await callLive(config, 'quote', { method: 'POST', json: { packageId, userInput } })
  const quote = unwrap(body, 'quote')
  const quoteId = pickString(quote, ['quoteId', 'quote_id', 'id', 'token'])
  if (!quoteId) {
    throw new ProviderError(
      'JCR ไม่ได้ส่ง quoteId กลับมา — แพ็กเกจแบบระบุจำนวนเองนี้สั่งอัตโนมัติไม่ได้ ให้กดเติมเองที่หน้าลงยอดขาย'
    )
  }
  return {
    quoteId,
    // เอกสาร: finalPrice = ราคาที่ถูกตัดจริงต่อหน่วย (cost คือทุนก่อนบวกมาร์จิ้น ห้ามเอามาเทียบ)
    price: pickNumber(quote, ['finalPrice', 'final_price', 'total', 'price', 'amount']),
    validUntil: pickString(quote, ['validUntil', 'valid_until']),
  }
}

export const jcr: ProviderAdapter = {
  kind: 'jcr',

  async getBalance(config) {
    // ยิงพร้อมกันสองเส้น: ยอดเงิน กับ ชื่อบัญชี — ชื่อบัญชีไว้ยืนยันว่าต่อถูกร้าน
    // ถ้า /me พังก็ไม่เป็นไร ยอดเงินสำคัญกว่า
    const [balanceRes, meRes] = await Promise.allSettled([
      callLive(config, 'balance'),
      callLive(config, 'me'),
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
      // เอกสาร: /me คืน { resellerId, companyName, contactEmail, status, credit }
      account: pickString(me, ['companyName', 'name', 'username', 'shopName', 'contactEmail']),
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

    // ใช้เลขอ้างอิงของบิลเป็นกุญแจกันซ้ำด้วย — ถ้าเน็ตสะดุดแล้วระบบยิงซ้ำ
    // จะได้ผลลัพธ์เดิมกลับมา ไม่กลายเป็นสองออเดอร์ที่ตัดเงินสองรอบ
    const body = await callLive(config, 'orders', {
      method: 'POST',
      form,
      idempotencyKey: `payjung-${input.ref}`,
    })
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
        const record = orderRecord(await callLive(config, `orders/${encodeURIComponent(order.orderId)}`))
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
    // เอกสาร: เส้นนี้ใช้ cursor ไม่ใช่เลขหน้า และบอกว่าหมดรายการแล้วด้วย hasMore / nextCursor
    let reachedEnd = false
    let cursor: string | null = null
    for (let round = 1; round <= LIST_MAX_PAGES; round++) {
      const body = await callLive(
        config,
        `orders?limit=${LIST_LIMIT}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
      )
      const list = asArray(body, 'orders')
      const found = list.find((row) => refOf(row) === order.ref)
      if (found) return mapStatus(found, null)

      // pagination อยู่ระดับบนสุดคู่กับ data — อ่านตรง ๆ ห้ามใช้ unwrap เพราะมันจะไล่ลง data ไปก่อน
      const page = (body && typeof body === 'object' ? (body as Json).pagination : null) as
        | Json
        | null
      const hasMore = page && typeof page === 'object' ? page.hasMore !== false : false
      cursor = pickString(page, ['nextCursor', 'next_cursor'])
      if (!hasMore || !cursor) {
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
  async fetchCatalog(config, opts) {
    const all = asArray(await callLive(config, 'products'), 'products')
    if (all.length === 0) {
      throw new ProviderError('JCR ไม่ได้ส่งรายการสินค้ามาเลย — ตรวจสอบสิทธิ์ของคีย์กับทีมงาน JCR')
    }

    // สินค้าที่เพิ่งดึงไปแล้วในรอบก่อน ข้ามไปก่อน จะได้เอาเวลาที่มีไปดึงส่วนที่ยังขาด
    // (ทั้งร้านมีสองร้อยกว่าสินค้า ยิงทีเดียวไม่ทันในเวลาที่ Vercel ให้ ต้องกดซ้ำสะสม)
    const have = opts?.have
    const products = have
      ? all.filter((p) => {
          const id = pickString(p, ['id', 'productId', 'product_id', 'code'])
          return !id || !have.has(id)
        })
      : all
    const skipped = all.length - products.length

    const out: CatalogEntry[] = []
    const deadline = Date.now() + CATALOG_BUDGET_MS
    const pacer = pacerOf(config)
    let cursor = 0
    /** สินค้าที่ดึงแพ็กเกจมาได้จริงในรอบนี้ */
    let handled = 0
    /** แพ็กเกจที่ได้ช่องกรอกครบจาก inputFields ตามเอกสาร */
    let fromSchema = 0
    /** สินค้าที่ต้องถอยไปอ่านช่องกรอกจากแบบฟอร์ม HTML */
    let fromForm = 0
    /** แพ็กเกจที่ปลายทางปิดขายอยู่ */
    let unavailable = 0
    /** แพ็กเกจที่ต้องแนบรูป ซึ่งหน้าเว็บลูกค้ายังทำไม่ได้ */
    let needsFile = 0
    /** แพ็กเกจที่ปลายทางไม่บอกราคา — ข้ามไปเพราะตั้งราคาขายให้ไม่ได้ */
    let noPrice = 0
    /** เหตุผลที่สินค้าแต่ละตัวดึงไม่สำเร็จ — เก็บไว้รายงาน ไม่ใช่แค่นับจำนวน */
    const failures: string[] = []

    /**
     * ถามแพ็กเกจของสินค้าหนึ่ง พร้อมลองใหม่เมื่อโดนปลายทางกัน
     * ตอนดึงทั้งร้านจะยิงเป็นร้อยเส้นรวด ผู้ให้บริการมักกันไว้ชั่วคราว
     * ถ้ายอมแพ้ตั้งแต่ครั้งแรก จะได้ของมาไม่ครบทั้งที่ปลายทางไม่ได้เสียอะไรเลย
     */
    const packagesOf = (productId: string): Promise<Json[]> =>
      limited(
        pacer,
        async () =>
          asArray(
            await api(config, `products/${encodeURIComponent(productId)}/packages`, {
              // เหลือเวลาเท่าไรก็ให้เส้นนี้ได้เท่านั้น จะได้ไม่ลากยาวจนทั้งฟังก์ชันโดนตัด
              timeoutMs: deadline - Date.now(),
            }),
            'packages'
          ),
        { attempts: CATALOG_RETRIES, deadline }
      )

    /**
     * ขอแบบฟอร์มกรอกข้อมูลของสินค้านั้นมาแปลงเป็นช่องกรอกของหน้าเว็บเรา
     * ใช้เมื่อคำตอบ JSON ไม่ได้บอกช่องกรอกมาด้วย ซึ่งเป็นกรณีปกติของเจ้านี้
     * ยอมยิงเพิ่มอีกหนึ่งเส้นต่อสินค้า เพราะถ้าไม่รู้ว่าต้องกรอกอะไร
     * ลูกค้าจะกรอกได้แค่ UID แล้วออเดอร์ถูกปฏิเสธ (หรือเติมผิดเซิร์ฟเวอร์)
     */
    const formFieldsOf = async (productId: string): Promise<ProviderField[]> => {
      try {
        const html = await limited(
          pacer,
          () =>
            api(config, `products/${encodeURIComponent(productId)}/packages?format=html`, {
              raw: true,
              timeoutMs: deadline - Date.now(),
            }),
          { attempts: 2, deadline }
        )
        return typeof html === 'string' ? parseHtmlForm(html) : []
      } catch (err) {
        // หมดเวลาต้องหยุดทั้งรอบ ส่วนพลาดอย่างอื่นถือว่าสินค้านี้ไม่มีฟอร์ม แล้วไปต่อ
        if (err instanceof OutOfTime) throw err
        return []
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
          // หมดเวลาของรอบนี้ — หยุดเส้นนี้ทันที ที่เหลือไปต่อรอบหน้า
          if (err instanceof OutOfTime) return
          // สินค้าตัวนี้ดึงไม่ได้ (เช่นถูกปิดอยู่) — ข้ามไป อย่าให้ทั้งรายการพัง
          // แต่ต้องจำเหตุผลไว้ ไม่งั้นคนกดจะไม่มีทางรู้ว่าทำไมของหาย
          failures.push(err instanceof Error ? err.message : String(err))
          continue
        }
        handled++

        // เผื่อไว้เฉย ๆ — ตามเอกสารช่องกรอกอยู่ที่ระดับแพ็กเกจ (inputFields) ไม่ใช่ระดับสินค้า
        const productFields = parseFields(product.fields ?? product.inputFields)
        /** แบบฟอร์ม HTML ของสินค้านี้ ยิงเอาตอนจำเป็นแล้วใช้ซ้ำ (null = ยังไม่เคยยิง) */
        let lazyForm: ProviderField[] | null = null

        for (const pack of packages) {
          const packageId = pickString(pack, ['id', 'packageId', 'package_id', 'code'])
          if (!packageId) continue

          // เอกสาร: available = false แปลว่าตอนนี้สั่งไม่ได้ ไม่ต้องเอามาขาย
          if (pack.available === false) {
            unavailable++
            continue
          }

          // ช่องแบบแนบรูปยังทำไม่ได้บนหน้าเว็บลูกค้า — เอามาขายแล้วสั่งไม่ผ่านแน่นอน
          if (needsFileUpload(pack.inputFields ?? pack.fields)) {
            needsFile++
            continue
          }

          const price = packPrice(pack)
          // ราคาทุนต้องรู้ก่อนถึงจะตั้งราคาขายอัตโนมัติได้
          // แพ็กเกจที่ปลายทางไม่บอกราคา (หรือราคา 0) ข้ามไป ไม่งั้นจะกลายเป็นสินค้าราคา 0 บนหน้าเว็บ
          if (price === null || price <= 0) {
            noPrice++
            continue
          }

          // เอกสาร: inputFields บอกครบว่าลูกค้าต้องกรอกอะไร ชื่อช่องอยู่ในคีย์ name
          // และช่องแบบเลือกได้จะมี options มาด้วย — เอามาใช้ตรง ๆ ได้เลย
          const packFields = parseFields(pack.inputFields ?? pack.fields ?? pack.userInput)
          let fields = packFields.length > 0 ? packFields : productFields
          if (packFields.length > 0) fromSchema++

          // ไม่มี inputFields มาด้วย (แพ็กเกจเก่า หรือเขาปรับรูปแบบ) — ถอยไปอ่านจากแบบฟอร์ม
          // ที่เขาเปิดให้ดึง (?format=html) ยิงครั้งเดียวต่อสินค้าแล้วใช้ซ้ำกับทุกแพ็กเกจ
          if (fields.length === 0) {
            if (lazyForm === null) {
              try {
                lazyForm = await formFieldsOf(productId)
              } catch (err) {
                if (err instanceof OutOfTime) return
                throw err
              }
              if (lazyForm.length > 0) fromForm++
            }
            fields = lazyForm
          }
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
            // ส่ง [] เมื่อสินค้านี้ไม่มีช่องกรอกจริง ๆ (ไม่ใช่ null ที่แปลว่า "ยังไม่รู้")
            // ระบบจะได้ไม่วนกลับมาถามฟอร์มของสินค้าตัวเดิมซ้ำทุกรอบจนไม่คืบไปไหน
            fields,
          })
        }
      }
    }

    // กันไว้อีกชั้น — ไม่ว่าเกิดอะไรขึ้นระหว่างทาง ของที่เก็บมาได้ต้องถูกส่งกลับไปบันทึกเสมอ
    try {
      await Promise.all(
        Array.from({ length: Math.min(CATALOG_CONCURRENCY, products.length) }, worker)
      )
    } catch (err) {
      if (!(err instanceof OutOfTime)) throw err
    }

    // ยังเหลือสินค้าที่ไม่ได้แตะเลยในรอบนี้ (หมดเวลา) หรือแตะแล้วแต่ไม่สำเร็จ
    const left = products.length - handled - failures.length
    // นับ "ที่ข้ามเพราะดึงไว้แล้ว" เป็นไม่ครบด้วย — รอบนี้ไม่ได้ดึงของพวกนั้นมา
    // ถ้าบอกว่าครบ ฝั่งที่บันทึกจะล้างของเดิมทิ้งแล้วใส่เฉพาะรอบนี้ = ของที่สะสมมาหายหมด
    const partial = left > 0 || failures.length > 0 || skipped > 0

    if (out.length === 0 && !partial) {
      throw new ProviderError(
        'ดึงรายการจาก JCR ได้ แต่ไม่มีแพ็กเกจที่ระบุราคาไว้เลย — ตรวจสอบสิทธิ์ราคาตัวแทนกับทีมงาน JCR'
      )
    }

    // เหตุผลที่เจอบ่อยที่สุด — บอกไปด้วยจะได้รู้ว่าต้องแก้ที่ไหน (โดนกัน / คีย์ / สินค้าปิด)
    const tally = new Map<string, number>()
    for (const reason of failures) tally.set(reason, (tally.get(reason) ?? 0) + 1)
    const topReason = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

    const warnings = [
      skipped > 0 ? `ข้าม ${skipped} สินค้าที่ดึงไว้แล้วก่อนหน้านี้` : null,
      left > 0
        ? `ยังเหลืออีก ${left} สินค้า (หมดเวลา ${CATALOG_BUDGET_MS / 1000} วินาที)`
        : null,
      failures.length > 0
        ? `${failures.length} สินค้าที่ดึงแพ็กเกจไม่สำเร็จ` +
          (topReason ? ` — ส่วนใหญ่เพราะ: ${topReason.slice(0, 140)}` : '')
        : null,
      noPrice > 0 ? `ข้าม ${noPrice} แพ็กเกจที่ JCR ไม่ได้บอกราคา` : null,
      fromSchema > 0 ? `ได้ช่องกรอกของลูกค้าครบ ${fromSchema} แพ็กเกจ` : null,
      fromForm > 0 ? `อ่านช่องกรอกจากแบบฟอร์มของ JCR อีก ${fromForm} สินค้า` : null,
      unavailable > 0 ? `ข้าม ${unavailable} แพ็กเกจที่ JCR ปิดขายอยู่` : null,
      needsFile > 0 ? `ข้าม ${needsFile} แพ็กเกจที่ต้องแนบรูป (หน้าเว็บลูกค้ายังทำไม่ได้)` : null,
      partial ? '👉 กด "ดึงรายการเกมทั้งหมด" ซ้ำอีกครั้ง ระบบจะไปต่อจากที่ค้างไว้' : null,
    ].filter(Boolean)

    return {
      entries: out,
      partial,
      note: warnings.length > 0 ? warnings.join(' · ') : null,
    }
  },
}
