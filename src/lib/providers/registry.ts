import 'server-only'
import { BuymError, addOrder, getAccount, getOrder, getProducts } from './24buym'
import { OVERTOPUP_SANDBOX_BASE, providerMeta } from './constants'
import { overtopup } from './overtopup'
import { providerCallbackUrl } from '../siteUrl'
import {
  ProviderError,
  type CatalogEntry,
  type ProviderAdapter,
  type ProviderConfig,
} from './types'

/** แปลง error เฉพาะของ 24BUYM ให้เป็นชนิดกลางที่เครื่องยนต์ส่งออเดอร์เข้าใจ */
function wrapBuym(err: unknown): never {
  if (err instanceof BuymError) {
    // ปลายทางไม่ตอบ/หมดเวลา = ลองใหม่ได้ ส่วนคีย์ผิดหรือข้อมูลผิด = ลองกี่ครั้งก็เหมือนเดิม
    const retryable = /ต่อ API ไม่ได้|ไม่ตอบ|HTTP 5\d\d|ไม่ใช่ JSON/.test(err.message)
    throw new ProviderError(err.message, retryable)
  }
  throw err
}

const buym: ProviderAdapter = {
  kind: '24buym',

  async getBalance(config) {
    try {
      const account = await getAccount(config.baseUrl, config.secret)
      if (!account.success) {
        throw new ProviderError(account.message ?? 'ปลายทางตอบกลับว่าไม่สำเร็จ')
      }
      return {
        balance: Number(account.points ?? 0) || 0,
        unit: 'พอยต์',
        account: account.username ?? null,
      }
    } catch (err) {
      wrapBuym(err)
    }
  },

  async placeOrder(config, input) {
    try {
      // บอกปลายทางว่าให้ยิงผลกลับมาที่ไหนเมื่อเติมเสร็จ
      // ไม่ส่งก็ยังทำงานได้ แต่สถานะจะอัปเดตเฉพาะตอนมีคนเปิดหน้าหลังร้านค้างไว้
      // (ลูกค้าที่สั่งตอนตีสองจะค้างเป็น "รอดำเนินการ" จนกว่าจะมีคนเปิดหลังร้าน)
      const callbackUrl = await providerCallbackUrl()

      const res = await addOrder(config.baseUrl, config.secret, {
        UserID: input.account,
        game_id: input.gameId,
        pack_code: input.sku,
        quantity: input.quantity,
        server_id: input.serverId || '0',
        ref_no: input.ref,
        ...(callbackUrl ? { callback_api: callbackUrl } : {}),
      })
      if (!res.success) {
        // ปลายทางปฏิเสธตั้งแต่แรก = ยังไม่ได้ตัดพอยต์ ถือว่าไม่สำเร็จอย่างชัดเจน
        throw new ProviderError(res.message ?? 'ปลายทางปฏิเสธคำสั่งเติม')
      }
      return {
        orderId: res.order_id != null ? String(res.order_id) : null,
        message: res.message ?? 'ส่งเข้าคิวปลายทางแล้ว',
      }
    } catch (err) {
      wrapBuym(err)
    }
  },

  async checkOrder(config, order) {
    try {
      // รู้เลขออเดอร์แล้วก็ถามตรง ๆ ถ้ายังไม่รู้ ให้ดึงรายการล่าสุดมาหาด้วยเลขอ้างอิงของเรา
      const res = order.orderId
        ? await getOrder(config.baseUrl, config.secret, { orderId: Number(order.orderId) })
        : await getOrder(config.baseUrl, config.secret, { limit: 100 })

      const list = res.orders ?? []
      const found = order.orderId
        ? (list.find((o) => String(o.order_id) === order.orderId) ?? list[0])
        : list.find((o) => o.ref_no === order.ref)

      if (!found) {
        return { state: 'missing', message: 'ปลายทางไม่พบออเดอร์นี้' }
      }

      const status = Number(found.status)
      const orderId = String(found.order_id)
      if (status === 2) return { state: 'success', message: found.message || 'เติมสำเร็จ', orderId }
      if (status === -1) {
        return { state: 'failed', message: found.message || 'ปลายทางแจ้งว่าเติมไม่สำเร็จ', orderId }
      }
      return {
        state: 'sent',
        message: found.message || (status === 1 ? 'กำลังเติม' : 'อยู่ในคิว'),
        orderId,
      }
    } catch (err) {
      wrapBuym(err)
    }
  },

  /** แผ่รายการเกม × เซิร์ฟเวอร์ × แพ็กเกจ ให้เป็นแถวเดียวต่อสินค้าหนึ่งชิ้น */
  async fetchCatalog(config) {
    try {
      const result = await getProducts(config.baseUrl, config.secret)
      if (!result.success) throw new ProviderError('ปลายทางตอบกลับว่าไม่สำเร็จ')

      const out: CatalogEntry[] = []
      for (const game of result.products ?? []) {
        const servers =
          game.servers?.length > 0 ? game.servers : [{ server_id: '0', server_name: '' }]
        for (const server of servers) {
          for (const pack of game.packages ?? []) {
            out.push({
              gameId: String(game.game_id),
              gameName: game.game_name,
              serverId: String(server.server_id ?? '0'),
              serverName: server.server_name || null,
              sku: String(pack.pack_code),
              packName: pack.pack_name,
              packDesc: pack.pack_desc ?? '',
              price: Number(pack.pack_price) || 0,
            })
          }
        }
      }
      return out
    } catch (err) {
      wrapBuym(err)
    }
  },
}

/**
 * ผู้ให้บริการที่ยังไม่ได้เขียนตัวเชื่อม — เก็บข้อมูลบัญชีไว้ได้ แต่ยังสั่งอัตโนมัติไม่ได้
 * พอได้เอกสาร API ของเจ้านั้นมาแล้ว เขียน adapter เพิ่มแล้วมาลงทะเบียนตรง ADAPTERS ด้านล่าง
 */
function notReady(kind: string): ProviderAdapter {
  const label = providerMeta(kind).label
  const fail = async (): Promise<never> => {
    throw new ProviderError(
      `ยังไม่ได้เขียนตัวเชื่อมของ "${label}" — ออเดอร์ของเจ้านี้ต้องกดเติมเองที่หน้าลงยอดขาย`
    )
  }
  return { kind, getBalance: fail, placeOrder: fail, checkOrder: fail }
}

const ADAPTERS: Record<string, ProviderAdapter> = {
  '24buym': buym,
  overtopup,
  userpass: notReady('userpass'),
  custom: notReady('custom'),
}

/** หยิบตัวเชื่อมตามชนิดของผู้ให้บริการ */
export function adapterFor(kind: string): ProviderAdapter {
  return ADAPTERS[kind] ?? notReady(kind)
}

/** เจ้านี้สั่งอัตโนมัติได้ไหม */
export function supportsAuto(kind: string) {
  return providerMeta(kind).autoSupported && kind in ADAPTERS
}

/**
 * แปลงแถวจากตาราง api_providers เป็นค่าตั้งค่าที่ adapter ใช้
 * โหมดทดสอบจะสลับไปใช้ที่อยู่ sandbox ของเจ้านั้นให้เอง ไม่ต้องแก้ base_url เอง
 */
export function toConfig(row: {
  id: number
  name: string
  kind: string
  base_url: string | null
  username: string | null
  api_key: string | null
  sandbox?: boolean | null
}): ProviderConfig {
  if (!row.api_key) {
    throw new ProviderError(`"${row.name}" ยังไม่ได้ตั้งคีย์ — ไปตั้งที่หน้าจัดการเว็บไซต์ก่อน`)
  }
  const sandbox = Boolean(row.sandbox)
  const meta = providerMeta(row.kind)
  const baseUrl =
    sandbox && row.kind === 'overtopup' ? OVERTOPUP_SANDBOX_BASE : (row.base_url ?? meta.fixedBaseUrl ?? null)

  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    baseUrl,
    username: row.username,
    secret: row.api_key,
    sandbox,
  }
}
