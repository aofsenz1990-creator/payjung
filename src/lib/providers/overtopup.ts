import 'server-only'
import { OVERTOPUP_DEFAULT_BASE } from './constants'
import { ProviderError, type CatalogEntry, type ProviderAdapter } from './types'

/**
 * ตัวเชื่อมต่อ API ของ OverTopup
 * เอกสาร: https://www.overtopup.com/api/document
 *
 * จุดที่ต่างจาก 24BUYM และต้องระวัง:
 *  1. ยืนยันตัวตนด้วย username + password ส่งไปในบอดี้ทุกครั้ง (ไม่ใช่คีย์เดี่ยว)
 *  2. บอดี้เป็น form-urlencoded ไม่ใช่ JSON
 *  3. ข้อผิดพลาดไม่ได้ส่งมาเป็น HTTP status แต่เป็นฟิลด์ error ในบอดี้ (HTTP อาจเป็น 200)
 *  4. ตามสถานะได้ด้วย order_no เท่านั้น — ค้นด้วย reference_no ของเราไม่ได้
 *     ทำให้ถ้ายิงไปแล้วไม่ได้ผลกลับ เราจะเช็กเองไม่ได้ ต้องพึ่ง callback หรือให้คนไปดู
 *  5. เติมแบบ UID สั่งได้ทีละ 1 ชิ้นต่อออเดอร์ (ไม่มีพารามิเตอร์ quantity)
 */

/** ยอดเงินตอบกลับมาเป็นข้อความมีคอมมา เช่น "1,345.00" ต้องตัดคอมมาก่อนแปลงเป็นตัวเลข */
function toNumber(value: unknown) {
  const n = Number.parseFloat(String(value ?? '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** รหัสข้อผิดพลาดที่ลองใหม่แล้วมีโอกาสสำเร็จ (ที่เหลือลองกี่ครั้งก็เหมือนเดิม) */
const RETRYABLE = new Set(['system_busy', 'try_again', 'timeout'])

/** แปลรหัสข้อผิดพลาดที่เจอบ่อยเป็นคำอธิบายที่บอกได้ว่าต้องไปแก้ตรงไหน */
const ERROR_HINT: Record<string, string> = {
  ip_not_authorized:
    'OverTopup ไม่อนุญาต IP ที่ยิงเข้าไป — เว็บเราอยู่บน Vercel ซึ่ง IP เปลี่ยนตลอด ' +
    'ต้องให้ OverTopup ปิดการล็อก IP ให้บัญชีเรา',
  invalid_username: 'ID ผู้ใช้ไม่ถูกต้อง — แก้ที่หน้าจัดการเว็บไซต์',
  invalid_password: 'รหัสผ่านไม่ถูกต้อง — แก้ที่หน้าจัดการเว็บไซต์',
  account_suspended: 'บัญชีของร้านที่ OverTopup ถูกระงับ — ติดต่อ OverTopup',
  insufficient_coin: 'เหรียญของร้านที่ OverTopup ไม่พอ — เติมเงินเข้าบัญชี OverTopup ก่อน',
  product_out_stock: 'สินค้าหมดที่ฝั่ง OverTopup',
  invalid_reference_no:
    'OverTopup ปฏิเสธเลขอ้างอิงนี้ อาจเพราะเคยใช้ส่งไปแล้ว — ' +
    'อย่าเพิ่งส่งซ้ำ ให้เข้าไปเช็กในระบบ OverTopup ก่อนว่าออเดอร์เข้าไปแล้วหรือยัง',
}

type ErrorBody = { error?: string; error_description?: string }

async function call<T>(
  baseUrl: string | null | undefined,
  path: string,
  body: Record<string, string>
): Promise<T> {
  const base = (baseUrl || OVERTOPUP_DEFAULT_BASE).replace(/\/+$/, '')

  let res: Response
  try {
    res = await fetch(`${base}/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams(body).toString(),
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

  // ข้อผิดพลาดมาเป็นฟิลด์ในบอดี้ ไม่ใช่ HTTP status จึงต้องเช็กตรงนี้ ไม่ใช่ res.ok
  const body_ = data as ErrorBody
  if (body_?.error) {
    const code = body_.error
    const detail = ERROR_HINT[code] ?? body_.error_description ?? ''
    throw new ProviderError(
      detail ? `${detail} (${code})` : `OverTopup แจ้งข้อผิดพลาด: ${code}`,
      RETRYABLE.has(code)
    )
  }

  return data as T
}

export const overtopup: ProviderAdapter = {
  kind: 'overtopup',

  async getBalance(config) {
    const data = await call<{ coin_balance?: string }>(config.baseUrl, 'coin-balance', {
      username: config.username ?? '',
      password: config.secret,
    })
    return {
      balance: toNumber(data.coin_balance),
      unit: 'เหรียญ',
      account: config.username,
    }
  },

  async placeOrder(config, input) {
    const productType = input.productType || 'gtopup_uid'

    // เติมแบบ UID ไม่มีพารามิเตอร์จำนวน สั่งได้ทีละชิ้นเท่านั้น
    // ถ้าปล่อยผ่านไปทั้งที่ลูกค้าซื้อหลายชิ้น จะกลายเป็นเก็บเงินเต็มแต่เติมให้ชิ้นเดียว
    if (productType === 'gtopup_uid' && input.quantity > 1) {
      throw new ProviderError(
        `OverTopup สั่งเติมแบบ UID ได้ทีละ 1 ชิ้น แต่บิลนี้สั่ง ${input.quantity} ชิ้น — ` +
          'ต้องแยกส่งเป็นหลายบิล หรือกดเติมเองที่ระบบ OverTopup'
      )
    }

    const body: Record<string, string> = {
      username: config.username ?? '',
      password: config.secret,
      product_type: productType,
      reference_no: input.ref,
      // ฟิลด์บังคับของ OverTopup ต้องส่งเสมอแม้จะไม่ได้เปิดรับ callback ไว้
      response_url: input.callbackUrl ?? '',
      product_id: input.sku,
    }

    if (productType === 'card') {
      body.quantity = String(input.quantity)
    } else {
      body.ref_uid = input.account
      // เกมที่ไม่มีเซิร์ฟเวอร์จะเก็บเป็น '0' ในระบบเรา ไม่ต้องส่งไป
      if (input.serverId && input.serverId !== '0') body.ref_server = input.serverId
    }

    const data = await call<{ order_no?: string; order_status?: string }>(
      config.baseUrl,
      'pay-order',
      body
    )

    if (!data.order_no) {
      throw new ProviderError('OverTopup ไม่ได้ส่งเลขออเดอร์กลับมา — ตรวจสอบในระบบ OverTopup ก่อนส่งซ้ำ')
    }
    return {
      orderId: String(data.order_no),
      message: `OverTopup รับออเดอร์แล้ว (${data.order_status ?? 'pending'})`,
    }
  },

  async checkOrder(config, order) {
    // OverTopup ค้นด้วยเลขอ้างอิงของเราไม่ได้ ถ้าไม่รู้เลขออเดอร์ก็ตรวจสอบไม่ได้เลย
    // ต้องตอบ 'unknown' ไม่ใช่ 'missing' เพราะ 'missing' จะทำให้ระบบส่งซ้ำ = เสี่ยงเติมสองรอบ
    if (!order.orderId) {
      return {
        state: 'unknown',
        message:
          'ยังไม่มีเลขออเดอร์ของ OverTopup จึงเช็กสถานะไม่ได้ — ' +
          'เข้าไปดูในระบบ OverTopup ด้วยเลขอ้างอิง ' +
          `${order.ref} ว่าออเดอร์เข้าไปแล้วหรือยัง`,
      }
    }

    const data = await call<{ order_status?: string; note?: string | null }>(
      config.baseUrl,
      'order-result',
      {
        username: config.username ?? '',
        password: config.secret,
        order_no: order.orderId,
      }
    )

    return mapStatus(data.order_status, data.note, order.orderId)
  },

  /**
   * ดึงรายการสินค้าทั้งหมด
   * ต่างจาก endpoint อื่นตรงที่เป็น GET และไม่ต้องยืนยันตัวตน
   *
   * customer_level เปลี่ยนราคาที่ได้ ('vip' ถูกกว่า 'general')
   * ถ้าดึงผิดระดับ ราคาทุนในระบบจะไม่ตรงกับที่ถูกตัดจริง = กำไรที่คำนวณได้ผิดตาม
   */
  async fetchCatalog(config, opts) {
    const base = (config.baseUrl || OVERTOPUP_DEFAULT_BASE).replace(/\/+$/, '')
    const level = opts.vip ? 'vip' : 'general'

    let res: Response
    try {
      res = await fetch(`${base}/product?customer_level=${level}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(30_000),
      })
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      throw new ProviderError(`ดึงรายการสินค้าจาก OverTopup ไม่ได้: ${reason}`, true)
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

    const err = data as ErrorBody
    if (err?.error) {
      throw new ProviderError(
        ERROR_HINT[err.error] ?? err.error_description ?? `OverTopup แจ้ง: ${err.error}`
      )
    }
    if (!Array.isArray(data)) {
      throw new ProviderError('OverTopup ส่งรายการสินค้ามาในรูปแบบที่ไม่รู้จัก')
    }

    type Game = {
      game_key?: string
      game_name?: string
      ref?: Record<string, unknown>
      products?: Array<{
        product_id?: string
        product_name?: string
        product_desc?: string
        price?: string
      }>
    }

    const out: CatalogEntry[] = []
    for (const game of data as Game[]) {
      const gameId = game.game_key
      if (!gameId) continue
      // ref บอกว่าเกมนี้ต้องถามอะไรจากลูกค้า — มีคีย์ uid = เติมด้วย UID
      // เกมที่ต้องใช้ไอดี+รหัสผ่านล็อกอิน ตัวเชื่อมเรายังไม่รองรับ
      const refKeys = Object.keys(game.ref ?? {})
      const needsLogin = refKeys.some((k) => /login|password/i.test(k))

      for (const pack of game.products ?? []) {
        if (!pack.product_id) continue
        out.push({
          gameId,
          gameName: game.game_name || gameId,
          serverId: '0', // OverTopup ไม่ได้แยกเซิร์ฟเวอร์ในรายการสินค้า
          serverName: null,
          sku: pack.product_id,
          packName: pack.product_name || pack.product_id,
          packDesc: pack.product_desc ?? '',
          price: toNumber(pack.price),
          productType: needsLogin ? 'gtopup_idpass' : 'gtopup_uid',
        })
      }
    }
    return out
  },
}

/** แปลงสถานะของ OverTopup เป็นสถานะกลางที่เครื่องยนต์ส่งออเดอร์เข้าใจ */
export function mapStatus(
  status: string | undefined,
  note: string | null | undefined,
  orderId: string | null
) {
  const detail = note ? ` — ${note}` : ''
  switch (status) {
    case 'success':
      return { state: 'success' as const, message: `OverTopup เติมสำเร็จ${detail}`, orderId }
    case 'cancel':
      // ยกเลิกแน่นอน = ไม่ได้เติมเข้าเกม คืนเครดิตลูกค้าได้อย่างปลอดภัย
      return { state: 'failed' as const, message: `OverTopup ยกเลิกออเดอร์${detail}`, orderId }
    case 'problem':
      // เอกสารไม่ได้บอกว่าจบแล้วหรือยัง จึงไม่คืนเงินอัตโนมัติ ให้คนเข้าไปตรวจก่อน
      return {
        state: 'attention' as const,
        message: `OverTopup แจ้งว่ามีปัญหา${detail} — ตรวจสอบก่อนคืนเครดิตให้ลูกค้า`,
        orderId,
      }
    case 'pending':
    default:
      return { state: 'sent' as const, message: `OverTopup กำลังดำเนินการ${detail}`, orderId }
  }
}
