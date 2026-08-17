import 'server-only'
import { q1 } from './db'

/**
 * เงื่อนไข SQL ของ "แพ็กที่ราคาในหลังร้านยังไม่ตรงกับที่ขึ้นเว็บ"
 *
 * เขียนไว้ที่เดียว เพราะตัวนับกับตัวสั่งเผยแพร่ต้องมองตรงกันเป๊ะ
 * ไม่งั้นจะเจออาการ "ขึ้นว่ามี 3 แพ็กรอเผยแพร่ กดแล้วบอกว่าไม่มีอะไรเปลี่ยน"
 */
export const PRICE_DIRTY_SQL = `(products.published_sell_price is distinct from products.sell_price
   or products.published_partner_price is distinct from products.partner_price)`

/** จำนวนแพ็กเกจที่ราคายังรอเผยแพร่ (ระบุเกมได้ ไม่ระบุ = ทั้งร้าน) */
export async function countPendingPrices(gameId?: number) {
  try {
    const row = await q1<{ n: number }>(
      `select count(*)::int as n from products
        where is_active and ${PRICE_DIRTY_SQL}
          ${gameId ? 'and game_id = $1' : ''}`,
      gameId ? [gameId] : []
    )
    return row?.n ?? 0
  } catch {
    // คอลัมน์ยังไม่ถูกสร้าง หรือฐานข้อมูลมีปัญหาชั่วคราว — ไม่ต้องโชว์แถบเตือน ดีกว่าทำหน้าพัง
    return 0
  }
}
