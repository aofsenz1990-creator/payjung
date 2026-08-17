'use server'

import { revalidatePath } from 'next/cache'
import { q, q1 } from '@/lib/db'
import { requireAnyPage } from '@/lib/auth'
import { getShopCustomer } from '@/lib/shop'
import { clip, customerError, friendlyError, int, optStr, str } from '@/lib/form'
import type { ActionState } from '@/components/ActionForm'

/**
 * ร้านส่งข้อความถึงลูกค้า — ใช้ส่งโค้ดบัตรเติมเกมเป็นหลัก
 *
 * เข้าถึงได้จากทั้งหน้าลงยอดขาย (ส่งโค้ดของบิลนั้น) และหน้ารายชื่อลูกค้า (ส่งข้อความทั่วไป)
 * จึงยอมรับสิทธิ์ของทั้งสองเมนู
 */
export async function sendCustomerMessageAction(formData: FormData): Promise<ActionState> {
  const user = await requireAnyPage('sales', 'history', 'customers')

  const customerId = int(formData, 'customer_id')
  const saleId = int(formData, 'sale_id') || null
  const kind = str(formData, 'kind') === 'code' ? 'code' : 'message'
  const title = optStr(formData, 'title')
  const body = clip(str(formData, 'body'), 2000)

  if (!customerId) return { error: 'ไม่พบลูกค้าของรายการนี้' }
  if (!body) return { error: 'กรุณาพิมพ์ข้อความที่จะส่ง' }

  let customerName = ''
  try {
    // ต้องเป็นลูกค้าที่เปิดใช้หน้าเว็บไว้ ไม่งั้นส่งไปก็ไม่มีใครเห็น
    const target = await q1<{ name: string; web_enabled: boolean }>(
      'select name, web_enabled from customers where id = $1',
      [customerId]
    )
    if (!target) return { error: 'ไม่พบลูกค้ารายนี้' }
    if (!target.web_enabled) {
      return {
        error: `"${target.name}" ยังไม่ได้เปิดบัญชีเข้าใช้หน้าเว็บ จึงยังเปิดอ่านข้อความไม่ได้ — เปิดให้ก่อนที่เมนูรายชื่อลูกค้า`,
      }
    }
    customerName = target.name

    await q(
      `insert into customer_messages (customer_id, sale_id, kind, title, body, created_by)
       values ($1, $2, $3, $4, $5, $6)`,
      [customerId, saleId, kind, title, body, user.id]
    )
  } catch (err) {
    return { error: friendlyError(err, 'ส่งข้อความไม่สำเร็จ') }
  }

  revalidatePath('/shop/me')
  revalidatePath('/sales')
  revalidatePath('/customers')
  return {
    ok:
      kind === 'code'
        ? `ส่งโค้ดให้ ${customerName} แล้ว ลูกค้าจะเห็นในกล่องข้อความบนหน้าเว็บทันที`
        : `ส่งข้อความให้ ${customerName} แล้ว`,
  }
}

/** ลูกค้ากดอ่าน — ทำเครื่องหมายว่าอ่านแล้วทั้งหมด เพื่อให้ตัวเลขแจ้งเตือนหายไป */
export async function markMessagesReadAction(): Promise<ActionState> {
  const customer = await getShopCustomer()
  if (!customer) return { error: 'กรุณาเข้าสู่ระบบก่อน' }

  try {
    await q(
      'update customer_messages set read_at = now() where customer_id = $1 and read_at is null',
      [customer.id]
    )
  } catch (err) {
    return { error: customerError(err) }
  }

  revalidatePath('/shop/me')
  return { ok: 'อ่านข้อความทั้งหมดแล้ว' }
}
