import 'server-only'
import { OVERTOPUP_DEFAULT_BASE } from './constants'
import { INTERACTIVE_MAX_WAIT_MS, limited, pacerFor, retryAfterMs } from './http'
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

/**
 * เว้นระยะระหว่างการยิงอย่างน้อยเท่านี้ — OverTopup กันการยิงถี่ไว้ (RATE_LIMIT_EXCEEDED)
 * ตอนตามสถานะออเดอร์หลายบิลพร้อมกัน จะยิงติด ๆ กันจนโดนกันได้ง่าย
 */
const GAP_MS = 250

/** ตัวคุมจังหวะประจำบัญชี ใช้ร่วมกันทั้งตอนสั่ง ตามสถานะ และดึงรายการ */
function pacerOf(key: string) {
  return pacerFor(`overtopup:${key.slice(-6)}`, GAP_MS)
}

/**
 * เรียก API — เว้นจังหวะให้ก่อน แล้วลองใหม่สั้น ๆ ถ้าโดนกัน
 * ทุกเส้นของเจ้านี้มีคนรออยู่หน้าจอ จึงยอมแพ้เร็วแล้วให้เครื่องยนต์เอาเข้าคิวใหม่
 * ดีกว่าค้างหน้าเว็บลูกค้าไว้เป็นนาที
 */
function api<T>(
  baseUrl: string | null | undefined,
  key: string,
  path: string,
  init?: { method?: 'GET' | 'POST'; body?: unknown }
): Promise<T> {
  return limited(pacerOf(key), () => rawApi<T>(baseUrl, key, path, init), {
    attempts: 2,
    maxWaitMs: INTERACTIVE_MAX_WAIT_MS,
  })
}

/** ยิงจริงหนึ่งครั้ง — ใส่ Bearer token ให้ทุกครั้ง และแปลง error ของ OverTopup เป็นชนิดกลาง */
async function rawApi<T>(
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
      res.status >= 500 || res.status === 429,
      retryAfterMs(res.headers.get('retry-after'))
    )
  }

  // ปลายทางตอบรหัสไม่สำเร็จแต่ไม่ได้ใส่ code มาในเนื้อหา (เช่นโดนกันที่ชั้นหน้าเว็บ)
  // ถ้าไม่ดักไว้ จะถูกมองว่าสำเร็จแล้วอ่านค่าไม่เจอ กลายเป็นบั๊กที่ตามยาก
  if (!res.ok) {
    throw new ProviderError(
      `OverTopup ตอบ HTTP ${res.status}`,
      res.status >= 500 || res.status === 429,
      retryAfterMs(res.headers.get('retry-after'))
    )
  }

  const body = data as ApiError & { data?: unknown }
  if (body?.status === 'error' || body?.code) {
    const code = body.code ?? 'UNKNOWN'
    const parts = [ERROR_HINT[code], body.message && `ปลายทางแจ้ง: ${body.message}`]
    const detail = parts.filter(Boolean).join(' · ')
    throw new ProviderError(
      detail ? `${detail} (${code})` : `OverTopup แจ้งข้อผิดพลาด: ${code}`,
      // 429 = โดนกันเพราะยิงถี่ ลองใหม่ได้เสมอแม้ปลายทางไม่ได้ส่งรหัสมาให้
      RETRYABLE.has(code) || res.status === 429,
      // ปลายทางบอกเองว่าให้รอเท่าไร ใช้ค่านั้นแทนการเดา
      retryAfterMs(res.headers.get('retry-after'))
    )
  }

  return body.data as T
}

type ProductList = Array<{
  type?: string
  id: number
  name: string
  packages?: Array<{ id: number; name: string; description?: string; price: number }>
  // option = ตัวเลือกที่มีให้เลือก เช่นเซิร์ฟเวอร์ Asia / America / Europe
  fields?: Array<{ key: string; label: string; option?: Array<{ value: string; label: string }> }>
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

    // สินค้าแบบ UID ต้องบอกว่าจะเติมเข้าไอดีไหน
    // เกมที่ต้องเลือกเซิร์ฟเวอร์/ภูมิภาคจะมีค่าเพิ่มมาใน input.fields ซึ่งต้องส่งไปให้ครบ
    // ส่งไม่ครบ = ออเดอร์ถูกปฏิเสธ หรือแย่กว่านั้นคือเติมเข้าผิดเซิร์ฟเวอร์
    if (kind === 'uid') {
      const fields: Record<string, string> = { ...(input.fields ?? {}) }
      if (!fields.uid) fields.uid = input.account
      // เผื่อกรณีเก่าที่เก็บเซิร์ฟเวอร์ไว้ที่ตัวแพ็กเกจแทนที่จะถามลูกค้า
      if (!fields.server && input.serverId && input.serverId !== '0') {
        fields.server = input.serverId
      }
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

    // ยิงพร้อมกันทั้งสองชนิด — ยิงเรียงกันแล้วรวมเวลาเกินที่ Vercel ยอมให้ทำงานต่อรีเควสต์
    const kinds = ['uid', 'card'] as const
    const lists = await Promise.all(
      kinds.map((kind) => api<ProductList>(config.baseUrl, config.secret, `${kind}/products`))
    )

    for (const [i, kind] of kinds.entries()) {
      const list = lists[i]
      for (const product of list ?? []) {
        if (!product?.id) continue
        // เกมที่ต้องกรอกมากกว่าไอดีกับเซิร์ฟเวอร์ ระบบเรายังส่งให้ไม่ครบ
        // เก็บช่องที่เกมนี้บังคับกรอกไว้ทั้งชุด รวมตัวเลือกเซิร์ฟเวอร์/ภูมิภาค
        // หน้าเว็บลูกค้าจะเอาไปสร้างช่องกรอกให้ตรงกับที่ปลายทางต้องการ
        const fields = (product.fields ?? [])
          .filter((f) => f?.key)
          .map((f) => ({
            key: f.key,
            label: f.label || f.key,
            options: Array.isArray(f.option) && f.option.length > 0 ? f.option : undefined,
          }))

        for (const pack of product.packages ?? []) {
          if (!pack?.id) continue
          out.push({
            gameId: String(product.id),
            gameName: product.name,
            serverId: '0',
            serverName: null,
            sku: String(pack.id),
            packName: pack.name,
            packDesc: pack.description ?? '',
            price: Number(pack.price) || 0,
            productType: kind,
            fields: fields.length > 0 ? fields : null,
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
