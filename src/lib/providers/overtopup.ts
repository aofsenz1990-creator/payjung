import 'server-only'
import { OVERTOPUP_DEFAULT_BASE } from './constants'
import { ProviderError, type CatalogEntry, type ProviderAdapter } from './types'

/**
 * ตัวเชื่อมต่อ OverTopup Reseller API (v2)
 * เอกสาร: https://documenter.getpostman.com/view/29486531/2sBY4PNzXY
 * ขอเปิดสิทธิ์และดูคีย์ได้ที่ OverTopup > User > Reseller API
 *
 * API ชุดนี้ออกแบบมาดีกว่าตัวเก่ามาก และรองรับสิ่งที่ระบบเราต้องการครบ:
 *  - ค้นออเดอร์ด้วย reference_id ของเราได้ → ถามปลายทางก่อนส่งซ้ำได้เสมอ
 *  - reference_id ซ้ำจะถูกปฏิเสธ (DUPLICATE_REFERENCE_ID) → กันเติมซ้ำที่ฝั่งเขาอีกชั้น
 *  - ส่งราคาไปด้วยได้ ถ้าไม่ตรงกับราคาปัจจุบันเขาจะปฏิเสธ (PRICE_NOT_MATCH)
 *    → กันขายขาดทุนเงียบ ๆ ตอนปลายทางขึ้นราคาแล้วเราไม่รู้
 *  - มี Sandbox ให้ทดสอบทั้งกระบวนการโดยไม่เสียเงินจริง
 */

/** สินค้าสามแบบของ OverTopup ส่งพารามิเตอร์คนละชุดและใช้ path คนละอัน */
export type OverTopupKind = 'uid' | 'card' | 'idpass'

function pathKind(productType: string | null | undefined): OverTopupKind {
  if (productType === 'card') return 'card'
  if (productType === 'idpass') return 'idpass'
  return 'uid'
}

/** เลขออเดอร์ขึ้นต้นด้วยตัวอักษรบอกชนิด: G=uid, P=idpass, C=card */
function kindFromOrderId(orderId: string): OverTopupKind | null {
  const c = orderId.trim().charAt(0).toUpperCase()
  return c === 'C' ? 'card' : c === 'P' ? 'idpass' : c === 'G' ? 'uid' : null
}

/** รหัสข้อผิดพลาดที่ลองใหม่แล้วมีโอกาสสำเร็จ */
const RETRYABLE = new Set(['RATE_LIMIT_EXCEEDED', 'INTERNAL_ERROR'])

const ERROR_HINT: Record<string, string> = {
  UNAUTHORIZED:
    'API Key ไม่ถูกต้องหรือยังไม่ได้เปิดสิทธิ์ — ดูคีย์ที่ OverTopup > User > Reseller API ' +
    'และติดต่อเจ้าหน้าที่เพื่อขอเปิดใช้งาน API',
  RATE_LIMIT_EXCEEDED: 'ยิงถี่เกินไป ระบบจะลองใหม่ให้เอง',
  INSUFFICIENT_BALANCE: 'ยอดเงินของร้านที่ OverTopup ไม่พอ — เติมเงินเข้าบัญชี OverTopup ก่อน',
  OUT_OF_STOCK: 'สินค้าหมดที่ฝั่ง OverTopup',
  PRODUCT_NOT_FOUND: 'ไม่พบสินค้านี้ที่ OverTopup — กดดึงรายการใหม่แล้วนำเข้าอีกครั้ง',
  PACKAGE_NOT_FOUND: 'ไม่พบแพ็กเกจนี้ที่ OverTopup — กดดึงรายการใหม่แล้วนำเข้าอีกครั้ง',
  PRICE_NOT_MATCH:
    'ราคาทุนในระบบเราไม่ตรงกับราคาปัจจุบันของ OverTopup — ' +
    'ยังไม่ได้สั่งซื้อ ให้กดดึงรายการใหม่เพื่ออัปเดตราคาทุนก่อน (กันขายขาดทุน)',
  DUPLICATE_REFERENCE_ID:
    'เลขอ้างอิงนี้เคยส่งไปแล้ว = ออเดอร์เข้าระบบ OverTopup ไปก่อนหน้านี้ ' +
    'ระบบจะไม่สั่งซ้ำ ให้กดตามสถานะแทน',
  ORDER_NOT_FOUND: 'ไม่พบออเดอร์นี้ที่ OverTopup',
}

type ApiError = { status?: string; code?: string; message?: string }

/** เรียก API — ใส่ Bearer token ให้ทุกครั้ง และแปลง error ของ OverTopup เป็นชนิดกลาง */
async function api<T>(
  baseUrl: string | null | undefined,
  key: string,
  path: string,
  init?: { method?: 'GET' | 'POST'; body?: unknown }
): Promise<T> {
  const base = (baseUrl || OVERTOPUP_DEFAULT_BASE).replace(/\/+$/, '')

  let res: Response
  try {
    res = await fetch(`${base}/${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    })
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new ProviderError(
      /timeout|abort/i.test(reason)
        ? 'ต่อ OverTopup ไม่ได้ภายใน 20 วินาที (ปลายทางไม่ตอบ)'
        : `ต่อ OverTopup ไม่ได้: ${reason}`,
      true
    )
  }

  const text = await res.text()
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new ProviderError(
      `OverTopup ตอบกลับไม่ใช่ JSON (HTTP ${res.status}) — ${text.slice(0, 120)}`,
      res.status >= 500
    )
  }

  const body = data as ApiError & { data?: unknown }
  if (body?.status === 'error' || body?.code) {
    const code = body.code ?? 'UNKNOWN'
    const parts = [ERROR_HINT[code], body.message && `ปลายทางแจ้ง: ${body.message}`]
    const detail = parts.filter(Boolean).join(' · ')
    throw new ProviderError(
      detail ? `${detail} (${code})` : `OverTopup แจ้งข้อผิดพลาด: ${code}`,
      RETRYABLE.has(code)
    )
  }

  return body.data as T
}

type ProductList = Array<{
  type?: string
  id: number
  name: string
  packages?: Array<{ id: number; name: string; description?: string; price: number }>
  fields?: Array<{ key: string; label: string }>
}>

type OrderData = {
  order_id?: string
  reference_id?: string
  status?: string
  message?: string
  total?: number
}

export const overtopup: ProviderAdapter = {
  kind: 'overtopup',

  async getBalance(config) {
    const data = await api<{ balance?: number }>(config.baseUrl, config.secret, 'balance')
    return {
      balance: Number(data?.balance ?? 0) || 0,
      unit: 'บาท',
      account: config.username || null,
    }
  },

  async placeOrder(config, input) {
    const kind = pathKind(input.productType)
    if (kind === 'idpass') {
      throw new ProviderError(
        'แพ็กเกจนี้เป็นแบบเติมด้วยไอดี+รหัสผ่าน ซึ่งต้องใช้ข้อมูลหลายช่อง ' +
          'หน้าเว็บเรายังเก็บให้ไม่ครบ — กดเติมเองที่ระบบ OverTopup'
      )
    }

    const productId = Number(input.gameId)
    const packageId = Number(input.sku)
    if (!Number.isFinite(productId) || !Number.isFinite(packageId)) {
      throw new ProviderError('รหัสสินค้า/แพ็กเกจฝั่ง OverTopup ไม่ใช่ตัวเลข — กดดึงรายการใหม่')
    }

    const body: Record<string, unknown> = {
      product_id: productId,
      package_id: packageId,
      quantity: input.quantity,
      reference_id: input.ref,
    }

    // ส่งราคาไปให้ตรวจด้วย ถ้าปลายทางขึ้นราคาแล้วเราไม่รู้ เขาจะปฏิเสธแทนที่จะตัดเงินเพิ่มเงียบ ๆ
    if (typeof input.unitPrice === 'number' && input.unitPrice > 0) {
      body.package_price = input.unitPrice
    }

    // สินค้าแบบ UID ต้องบอกว่าจะเติมเข้าไอดีไหน (บางเกมต้องระบุเซิร์ฟเวอร์ด้วย)
    if (kind === 'uid') {
      const fields: Record<string, string> = { uid: input.account }
      if (input.serverId && input.serverId !== '0') fields.server = input.serverId
      body.fields = fields
    }

    const data = await api<OrderData>(config.baseUrl, config.secret, `${kind}/orders`, {
      method: 'POST',
      body,
    })

    if (!data?.order_id) {
      throw new ProviderError('OverTopup ไม่ได้ส่งเลขออเดอร์กลับมา — กดตามสถานะก่อนส่งซ้ำ')
    }
    return {
      orderId: String(data.order_id),
      message: `OverTopup รับออเดอร์แล้ว (${data.status ?? 'pending'})`,
    }
  },

  async checkOrder(config, order) {
    // รู้เลขออเดอร์ก็อ่านชนิดจากตัวอักษรแรกได้เลย ถ้าไม่รู้ก็ใช้ชนิดที่ผูกไว้กับแพ็กเกจ
    const kind =
      (order.orderId ? kindFromOrderId(order.orderId) : null) ?? pathKind(order.productType)

    const query = order.orderId
      ? `order_id=${encodeURIComponent(order.orderId)}`
      : `reference_id=${encodeURIComponent(order.ref)}`

    let data: OrderData | null
    try {
      data = await api<OrderData>(config.baseUrl, config.secret, `${kind}/orders?${query}`)
    } catch (err) {
      // ปลายทางไม่รู้จักออเดอร์นี้ = คำสั่งไม่เคยเข้าไป ส่งใหม่ได้อย่างปลอดภัย
      if (err instanceof ProviderError && /ORDER_NOT_FOUND/.test(err.message)) {
        return { state: 'missing', message: 'OverTopup ไม่พบออเดอร์นี้' }
      }
      throw err
    }

    if (!data) return { state: 'missing', message: 'OverTopup ไม่พบออเดอร์นี้' }
    return mapStatus(data.status, data.message, data.order_id ?? order.orderId)
  },

  /**
   * ดึงรายการสินค้าทั้งแบบเติมด้วย UID และบัตรเงินสด
   * ข้ามแบบ idpass เพราะหน้าเว็บลูกค้ายังเก็บข้อมูลล็อกอินให้ไม่ได้
   */
  async fetchCatalog(config) {
    const out: CatalogEntry[] = []

    for (const kind of ['uid', 'card'] as const) {
      const list = await api<ProductList>(config.baseUrl, config.secret, `${kind}/products`)
      for (const product of list ?? []) {
        if (!product?.id) continue
        // เกมที่ต้องกรอกมากกว่าไอดีกับเซิร์ฟเวอร์ ระบบเรายังส่งให้ไม่ครบ
        const extra = (product.fields ?? [])
          .map((f) => f.key)
          .filter((k) => k !== 'uid' && k !== 'server')
        const note = extra.length > 0 ? ` [ต้องกรอกเพิ่ม: ${extra.join(', ')}]` : ''

        for (const pack of product.packages ?? []) {
          if (!pack?.id) continue
          out.push({
            gameId: String(product.id),
            gameName: product.name,
            serverId: '0',
            serverName: null,
            sku: String(pack.id),
            packName: pack.name,
            packDesc: (pack.description ?? '') + note,
            price: Number(pack.price) || 0,
            productType: kind,
          })
        }
      }
    }
    return out
  },
}

/**
 * แปลงสถานะของ OverTopup เป็นสถานะกลาง
 * ตามเอกสาร: pending = รอดำเนินการ, issue = ติดปัญหาต้องตรวจ,
 *            completed = สำเร็จ, cancelled = ถูกยกเลิก
 */
export function mapStatus(
  status: string | undefined,
  message: string | null | undefined,
  orderId: string | null
) {
  const detail = message ? ` — ${message}` : ''
  switch ((status ?? '').toLowerCase()) {
    case 'completed':
      return { state: 'success' as const, message: `OverTopup เติมสำเร็จ${detail}`, orderId }
    case 'cancelled':
    case 'canceled':
      // ยกเลิกแน่นอน = ไม่ได้เติมเข้าเกม คืนเครดิตลูกค้าได้อย่างปลอดภัย
      return { state: 'failed' as const, message: `OverTopup ยกเลิกออเดอร์${detail}`, orderId }
    case 'issue':
      // เอกสารระบุว่าอาจเป็นข้อมูลผิด ปัญหาฝั่งซัพพลายเออร์ หรือรอคนตรวจ
      // ยังไม่จบ จึงไม่คืนเงินอัตโนมัติ ให้คนเข้าไปดูก่อน
      return {
        state: 'attention' as const,
        message: `OverTopup แจ้งว่าติดปัญหา${detail} — ตรวจสอบก่อนคืนเครดิตให้ลูกค้า`,
        orderId,
      }
    case 'pending':
    default:
      return { state: 'sent' as const, message: `OverTopup กำลังดำเนินการ${detail}`, orderId }
  }
}
