import 'server-only'

/**
 * ตัวเชื่อมต่อ API ของ 24BUYM
 * เอกสาร: https://documenter.getpostman.com/view/31552876/2sBXqKnK9s
 *
 * จุดที่ต่างจาก API ทั่วไป: คีย์ (USER_KEY) แนบไปกับ "path ของ URL" ไม่ใช่ header
 * จึงต้องเรียกจากฝั่งเซิร์ฟเวอร์เท่านั้น ห้ามให้หลุดไปฝั่งเบราว์เซอร์เด็ดขาด
 */

export { BUYM_DEFAULT_BASE } from './constants'
import { BUYM_DEFAULT_BASE } from './constants'
import { INTERACTIVE_MAX_WAIT_MS, limited, pacerFor, retryAfterMs } from './http'

/** รหัสสถานะออเดอร์ตามเอกสาร */
export const BUYM_STATUS = {
  '-1': { label: 'ล้มเหลว (ระบบคืนเครดิตแล้ว)', tone: 'bad' },
  '0': { label: 'อยู่ในคิว', tone: 'warn' },
  '1': { label: 'กำลังเติม', tone: 'warn' },
  '2': { label: 'เติมสำเร็จ', tone: 'good' },
} as const

export type BuymAccount = {
  success: boolean
  points?: string
  username?: string
  uid?: number
  message?: string
}

export type BuymPackage = {
  pack_code: string
  pack_name: string
  pack_desc: string
  pack_price: string
}

export type BuymGame = {
  game_id: number
  game_name: string
  servers: Array<{ server_id: string; server_name: string }>
  packages: BuymPackage[]
}

export type BuymOrder = {
  order_id: number
  message: string
  ref_no: string
  status: number
  create_at: string
}

/**
 * ข้อผิดพลาดของ 24BUYM
 * มีสองค่านี้ติดมาด้วยเพื่อให้ตัวคุมจังหวะของกลาง (providers/http.ts) อ่านได้เหมือนเจ้าอื่น
 */
export class BuymError extends Error {
  readonly retryable: boolean
  readonly retryAfterMs: number | null
  constructor(message: string, retryable = false, retryAfterMs: number | null = null) {
    super(message)
    this.retryable = retryable
    this.retryAfterMs = retryAfterMs
  }
}

function endpoint(baseUrl: string | null | undefined, path: string, key: string) {
  const base = (baseUrl || BUYM_DEFAULT_BASE).replace(/\/+$/, '')
  return `${base}/${path}/${encodeURIComponent(key)}`
}

/**
 * เว้นระยะระหว่างการยิงอย่างน้อยเท่านี้
 * เจ้านี้ไม่ได้ประกาศเพดานไว้ในเอกสาร แต่ทุกเจ้ากันการยิงถี่กันทั้งนั้น
 * เผื่อไว้ก่อนดีกว่าไปเจอตอนลูกค้ากดซื้อพร้อมกันหลายคน
 */
const GAP_MS = 250

/** ตัวคุมจังหวะประจำบัญชี — คีย์เดียวกันคือบัญชีเดียวกัน ต้องเข้าคิวร่วมกัน */
function pacerOf(key: string) {
  return pacerFor(`24buym:${key.slice(-6)}`, GAP_MS)
}

/** ยิงผ่านตัวคุมจังหวะ พร้อมลองใหม่สั้น ๆ ถ้าโดนกัน (ทุกเส้นของเจ้านี้มีคนรออยู่หน้าจอ) */
function call<T>(url: string, init?: RequestInit): Promise<T> {
  // คีย์อยู่ท้าย path ของ URL — ใช้แยกคิวรายบัญชีได้โดยไม่ต้องส่งคีย์เข้ามาซ้ำ
  // ต้องตัด query ทิ้งก่อน (getOrder มี ?order_id=... ต่อท้าย) ไม่งั้นจะได้คิวคนละอันกับเส้นอื่น
  const key = url.split('?')[0].split('/').pop() ?? ''
  return limited(pacerOf(key), () => rawCall<T>(url, init), {
    attempts: 2,
    maxWaitMs: INTERACTIVE_MAX_WAIT_MS,
  })
}

async function rawCall<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      cache: 'no-store',
      headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(20_000),
    })
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new BuymError(
      /timeout|abort/i.test(reason)
        ? 'ต่อ API ไม่ได้ภายใน 20 วินาที (ปลายทางไม่ตอบ)'
        : `ต่อ API ไม่ได้: ${reason}`,
      true
    )
  }

  const text = await res.text()
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new BuymError(
      `ปลายทางตอบกลับไม่ใช่ JSON (HTTP ${res.status}) — ${text.slice(0, 120)}`,
      res.status >= 500 || res.status === 429,
      retryAfterMs(res.headers.get('retry-after'))
    )
  }

  if (res.status === 401) {
    throw new BuymError('คีย์ไม่ถูกต้องหรือหมดอายุ (HTTP 401) — ตรวจสอบ USER_KEY กับทีมงาน 24BUYM')
  }
  if (!res.ok) {
    const msg = (data as { message?: string })?.message
    // 429 = โดนกันเพราะยิงถี่ / 5xx = ปลายทางล่มชั่วคราว ทั้งสองอย่างลองใหม่แล้วมีโอกาสผ่าน
    throw new BuymError(
      `ปลายทางตอบ HTTP ${res.status}${msg ? ` — ${msg}` : ''}`,
      res.status >= 500 || res.status === 429,
      retryAfterMs(res.headers.get('retry-after'))
    )
  }
  return data as T
}

/** ดูข้อมูลบัญชีและเครดิตคงเหลือฝั่งผู้ให้บริการ — ใช้เป็นตัวทดสอบการเชื่อมต่อ */
export function getAccount(baseUrl: string | null, key: string) {
  return call<BuymAccount>(endpoint(baseUrl, 'getAccount', key))
}

/** ดึงรายการเกม/เซิร์ฟเวอร์/แพ็กเกจทั้งหมดที่เปิดขาย */
export function getProducts(baseUrl: string | null, key: string) {
  return call<{ success: boolean; products: BuymGame[] }>(
    endpoint(baseUrl, 'get_product_game', key)
  )
}

/**
 * สั่งเติมเกม
 * ข้อควรระวังตามเอกสาร: success = true แปลว่า "รับเข้าคิวแล้ว" เท่านั้น
 * ยังไม่ได้แปลว่าเติมสำเร็จ ต้องตามสถานะจาก getOrder หรือรอ callback อีกที
 */
export function addOrder(
  baseUrl: string | null,
  key: string,
  input: {
    UserID: string
    game_id: string
    pack_code: string
    quantity: number
    server_id?: string
    ref_no?: string
    callback_api?: string
  }
) {
  return call<{
    success: boolean
    order_id?: number
    old_point?: number
    new_point?: number
    message?: string
  }>(endpoint(baseUrl, 'addOrder', key), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ server_id: '0', ...input }),
  })
}

/** ตามสถานะออเดอร์ */
export function getOrder(
  baseUrl: string | null,
  key: string,
  opts: { orderId?: number; limit?: number } = {}
) {
  const url = new URL(endpoint(baseUrl, 'getOrder', key))
  if (opts.orderId) url.searchParams.set('order_id', String(opts.orderId))
  url.searchParams.set('limit', String(opts.limit ?? 20))
  return call<{ success: boolean; orders: BuymOrder[] }>(url.toString())
}
