'use server'

import { randomInt } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { q, q1 } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { getShopCustomer, pointsPerBaht, getSiteSettings } from '@/lib/shop'
import { clip, customerError, friendlyError, int, optStr, str } from '@/lib/form'
import { tooMany, TOO_MANY_MESSAGE } from '@/lib/ratelimit'
import type { ActionState } from '@/components/ActionForm'

/**
 * ตัวอักษรที่ใช้สร้างรหัส — ตัดตัวที่อ่านสับสนออกทั้งหมด
 * ไม่มี O/0, I/1/L เพราะลูกค้าต้องพิมพ์ตามจากกระดาษหรือรูปที่ส่งให้
 * พิมพ์ผิดตัวเดียวก็แลกไม่ได้ แล้วจะทักมาถามร้าน
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

function randomCode(prefix: string) {
  let body = ''
  for (let i = 0; i < 12; i++) {
    body += ALPHABET[randomInt(0, ALPHABET.length)]
    // คั่นทุก 4 ตัวให้อ่านและพิมพ์ง่าย
    if (i === 3 || i === 7) body += '-'
  }
  return prefix ? `${prefix}-${body}` : body
}

/**
 * สร้างโค้ดเครดิตหลายใบพร้อมกัน
 *
 * ใส่ทีเดียวทั้งชุดในคำสั่งเดียว ถ้ามีใบไหนรหัสชนกับของเดิมจะข้ามใบนั้นไป
 * (ฐานข้อมูลมี unique index กันไว้) แล้วบอกจำนวนที่สร้างได้จริงกลับไป
 */
export async function createCreditCodesAction(formData: FormData): Promise<ActionState> {
  const user = await requireAdmin()

  const count = Math.min(Math.max(int(formData, 'count', 1), 1), 200)
  const points = int(formData, 'points')
  const note = optStr(formData, 'note')
  const prefix = clip(str(formData, 'prefix').toUpperCase().replace(/[^A-Z0-9]/g, ''), 8)

  if (points <= 0) return { error: 'จำนวนเครดิตต้องมากกว่า 0' }

  try {
    const rows: string[] = []
    for (let i = 0; i < count; i++) rows.push(randomCode(prefix))

    // batch ใช้จัดกลุ่มว่าโค้ดชุดนี้สร้างพร้อมกัน เอาไว้ค้นและพิมพ์ทีหลัง
    const batch = `${new Date().toISOString().slice(0, 16).replace('T', ' ')}`

    const values = rows.map((_, i) => `($${i + 1}, $${rows.length + 1}, $${rows.length + 2}, $${rows.length + 3}, $${rows.length + 4})`).join(',')
    const created = await q<{ code: string }>(
      `insert into credit_codes (code, points, note, batch, created_by)
       values ${values}
       on conflict do nothing
       returning code`,
      [...rows, points, note, batch, user.id]
    )

    revalidatePath('/credit-codes')
    if (created.length === 0) return { error: 'สร้างโค้ดไม่สำเร็จ กรุณาลองใหม่' }
    return {
      ok:
        `สร้างโค้ดแล้ว ${created.length} ใบ ใบละ ${points.toLocaleString('th-TH')} เครดิต — ` +
        'กดปุ่มคัดลอกทั้งชุดด้านล่างเพื่อเอาไปส่งให้ลูกค้า',
    }
  } catch (err) {
    return { error: friendlyError(err, 'สร้างโค้ดไม่สำเร็จ') }
  }
}

/** ลบโค้ดที่ยังไม่ถูกใช้ (ที่ใช้ไปแล้วห้ามลบ เพราะเป็นหลักฐานว่าใครได้แต้มไป) */
export async function deleteCreditCodeAction(formData: FormData) {
  await requireAdmin()
  const id = int(formData, 'id')
  if (!id) return
  await q('delete from credit_codes where id = $1 and redeemed_by is null', [id])
  revalidatePath('/credit-codes')
}

/**
 * ลูกค้าแลกโค้ด
 *
 * ทั้งการตัดโค้ดและการบวกแต้มอยู่ในคำสั่งเดียว เพราะถ้าแยกกันแล้วพลาดกลางทาง
 * จะได้โค้ดที่ถูกใช้ไปแล้วแต่ลูกค้าไม่ได้แต้ม หรือแย่กว่านั้นคือกดรัว ๆ
 * แล้วได้แต้มหลายรอบจากโค้ดใบเดียว
 */
export async function redeemCreditCodeAction(formData: FormData): Promise<ActionState> {
  const customer = await getShopCustomer()
  if (!customer) return { error: 'กรุณาเข้าสู่ระบบก่อน' }

  const code = str(formData, 'code').trim().toUpperCase()
  if (!code) return { error: 'กรุณากรอกโค้ด' }

  // กันเดาโค้ดมั่ว ๆ ทีละใบ
  if (await tooMany(`redeem:customer:${customer.id}`, 10, 600)) {
    return { error: TOO_MANY_MESSAGE }
  }

  try {
    const rows = await q<{ points: number; balance: number }>(
      `with c as (
         update credit_codes
            set redeemed_by = $1, redeemed_at = now()
          where upper(code) = upper($2) and redeemed_by is null
         returning id, points
       ),
       cust as (
         update customers set points = customers.points + c.points
           from c where customers.id = $1
         returning customers.id, customers.points
       ),
       tx as (
         insert into point_transactions (customer_id, kind, points, balance_after, note)
         select cust.id, 'redeem', c.points, cust.points, 'แลกโค้ดเครดิต' from cust, c
       )
       select c.points::float8 as points, cust.points::float8 as balance from c, cust`,
      [customer.id, code]
    )

    if (rows.length === 0) {
      return { error: 'โค้ดนี้ไม่ถูกต้อง หรือถูกใช้ไปแล้ว' }
    }

    revalidatePath('/shop/credit')
    revalidatePath('/shop/me')
    return {
      ok: `รับ ${rows[0].points.toLocaleString('th-TH')} เครดิตแล้ว — ตอนนี้มี ${rows[0].balance.toLocaleString('th-TH')} เครดิต`,
    }
  } catch (err) {
    return { error: customerError(err, 'แลกโค้ดไม่สำเร็จ') }
  }
}

/** ลูกค้าแลกเครดิตเป็นยอดเงินที่ใช้ซื้อของได้ */
export async function exchangePointsAction(formData: FormData): Promise<ActionState> {
  const customer = await getShopCustomer()
  if (!customer) return { error: 'กรุณาเข้าสู่ระบบก่อน' }

  const points = int(formData, 'points')
  const rate = pointsPerBaht(await getSiteSettings())

  if (points <= 0) return { error: 'กรุณากรอกจำนวนเครดิตที่ต้องการแลก' }
  if (points % rate !== 0) {
    return { error: `ต้องแลกเป็นจำนวนที่หารด้วย ${rate} ลงตัว (${rate} เครดิต = 1 บาท)` }
  }

  const baht = points / rate

  try {
    const rows = await q<{ points: number; credit: number }>(
      `with cust as (
         update customers
            set points = customers.points - $2,
                credit = customers.credit + $3
          where id = $1 and customers.points >= $2
         returning id, points, credit
       ),
       ptx as (
         insert into point_transactions (customer_id, kind, points, balance_after, amount, note)
         select id, 'exchange', -$2, points, $3, 'แลกเครดิตเป็นยอดเงิน' from cust
       ),
       ctx as (
         insert into credit_transactions (customer_id, kind, amount, balance_after, note)
         select id, 'topup', $3, credit, 'แลกมาจากเครดิต' from cust
       )
       select points::float8 as points, credit::float8 as credit from cust`,
      [customer.id, points, baht]
    )

    if (rows.length === 0) return { error: 'เครดิตไม่พอ' }

    revalidatePath('/shop/credit')
    revalidatePath('/shop/me')
    revalidatePath('/customers')
    return {
      ok:
        `แลก ${points.toLocaleString('th-TH')} เครดิต เป็นยอดเงิน ${baht.toLocaleString('th-TH')} บาทแล้ว — ` +
        `เหลือ ${rows[0].points.toLocaleString('th-TH')} เครดิต · ยอดเงิน ${rows[0].credit.toLocaleString('th-TH')} บาท`,
    }
  } catch (err) {
    return { error: customerError(err, 'แลกเครดิตไม่สำเร็จ') }
  }
}

/** ร้านปรับเครดิตให้ลูกค้าเอง (เพิ่ม/ลด) */
export async function adjustPointsAction(formData: FormData): Promise<ActionState> {
  await requireAdmin()
  const customerId = int(formData, 'customer_id')
  const points = int(formData, 'points')
  const note = optStr(formData, 'note')

  if (!customerId) return { error: 'ไม่พบลูกค้า' }
  if (points === 0) return { error: 'กรอกจำนวนเครดิตที่ต้องการเพิ่มหรือลด (ใส่ลบเพื่อหัก)' }

  try {
    const rows = await q<{ name: string; balance: number }>(
      `with cust as (
         update customers set points = customers.points + $2
          where id = $1 and (customers.points + $2) >= 0
         returning id, name, points
       ),
       tx as (
         insert into point_transactions (customer_id, kind, points, balance_after, note)
         select id, 'adjust', $2, points, $3 from cust
       )
       select name, points::float8 as balance from cust`,
      [customerId, points, note]
    )
    if (rows.length === 0) return { error: 'ปรับไม่ได้ เพราะเครดิตจะติดลบ' }

    revalidatePath('/customers')
    revalidatePath('/shop/credit')
    return {
      ok: `ปรับเครดิตให้ ${rows[0].name} แล้ว — คงเหลือ ${rows[0].balance.toLocaleString('th-TH')} เครดิต`,
    }
  } catch (err) {
    return { error: friendlyError(err, 'ปรับเครดิตไม่สำเร็จ') }
  }
}
