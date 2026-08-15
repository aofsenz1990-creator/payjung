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

export class BuymError extends Error {}

function endpoint(baseUrl: string | null | undefined, path: string, key: string) {
  const base = (baseUrl || BUYM_DEFAULT_BASE).replace(/\/+$/, '')
  return `${base}/${path}/${encodeURIComponent(key)}`
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
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
        : `ต่อ API ไม่ได้: ${reason}`
    )
  }

  const text = await res.text()
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new BuymError(
      `ปลายทางตอบกลับไม่ใช่ JSON (HTTP ${res.status}) — ${text.slice(0, 120)}`
    )
  }

  if (res.status === 401) {
    throw new BuymError('คีย์ไม่ถูกต้องหรือหมดอายุ (HTTP 401) — ตรวจสอบ USER_KEY กับทีมงาน 24BUYM')
  }
  if (!res.ok) {
    const msg = (data as { message?: string })?.message
    throw new BuymError(`ปลายทางตอบ HTTP ${res.status}${msg ? ` — ${msg}` : ''}`)
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
