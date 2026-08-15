'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { q, q1 } from '@/lib/db'
import { requireAdmin, requirePage } from '@/lib/auth'
import { getShopCustomer } from '@/lib/shop'
import { supabaseAdmin, supabaseServer } from '@/lib/supabase'
import { bool, decimal, friendlyError, int, optStr, str } from '@/lib/form'
import type { ActionState } from '@/components/ActionForm'

/* ------------------------------ เครดิตลูกค้า ------------------------------ */

/** ร้านเติม/ตัดเครดิตให้ลูกค้า — ทุกครั้งจะบันทึกลงสมุดบัญชีเครดิตเสมอ */
export async function adjustCreditAction(formData: FormData): Promise<ActionState> {
  const user = await requirePage('customers')
  const customerId = int(formData, 'customer_id')
  const amount = decimal(formData, 'amount')
  const kind = str(formData, 'kind') === 'deduct' ? 'deduct' : 'topup'
  const note = optStr(formData, 'note')

  if (!customerId) return { error: 'ไม่พบลูกค้า' }
  if (amount <= 0) return { error: 'จำนวนเงินต้องมากกว่า 0' }

  const delta = kind === 'topup' ? amount : -amount

  try {
    const rows = await q<{ name: string; balance_after: number }>(
      `with upd as (
         update customers set credit = credit + $2
          where id = $1 and (credit + $2) >= 0
         returning id, name, credit
       ),
       tx as (
         insert into credit_transactions (customer_id, kind, amount, balance_after, note, created_by)
         select id, $3, $2, credit, $4, $5 from upd
       )
       select name, credit::float8 as balance_after from upd`,
      [customerId, delta, kind === 'topup' ? 'topup' : 'adjust', note, user.id]
    )

    if (rows.length === 0) return { error: 'ตัดเครดิตไม่ได้ เพราะเครดิตคงเหลือจะติดลบ' }

    revalidatePath('/customers')
    return {
      ok:
        `${kind === 'topup' ? 'เติมเครดิต' : 'ตัดเครดิต'} ${amount.toLocaleString('th-TH')} บาท ` +
        `ให้ ${rows[0].name} แล้ว — คงเหลือ ${rows[0].balance_after.toLocaleString('th-TH')} บาท`,
    }
  } catch (err) {
    return { error: friendlyError(err, 'ปรับเครดิตไม่สำเร็จ') }
  }
}

/** เปิดบัญชีให้ลูกค้าเข้าใช้หน้าเว็บได้ (ร้านตั้งอีเมลและรหัสผ่านให้) */
export async function createCustomerLoginAction(formData: FormData): Promise<ActionState> {
  await requireAdmin()
  const customerId = int(formData, 'customer_id')
  const email = str(formData, 'email')
  const password = str(formData, 'password')

  if (!customerId) return { error: 'ไม่พบลูกค้า' }
  if (!email.includes('@')) return { error: 'กรุณากรอกอีเมลให้ถูกต้อง' }
  if (password.length < 8) return { error: 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร' }

  try {
    const admin = supabaseAdmin()
    const existing = await q1<{ auth_user_id: string | null }>(
      'select auth_user_id from customers where id = $1',
      [customerId]
    )

    if (existing?.auth_user_id) {
      const { error } = await admin.auth.admin.updateUserById(existing.auth_user_id, {
        email,
        password,
      })
      if (error) return { error: error.message }
      await q('update customers set web_enabled = true where id = $1', [customerId])
      revalidatePath('/customers')
      return { ok: 'อัปเดตบัญชีเข้าใช้เว็บของลูกค้าแล้ว' }
    }

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (error || !data.user) {
      return { error: /already/i.test(error?.message ?? '') ? 'อีเมลนี้ถูกใช้ไปแล้ว' : (error?.message ?? 'สร้างบัญชีไม่สำเร็จ') }
    }

    await q('update customers set auth_user_id = $2, web_enabled = true where id = $1', [
      customerId,
      data.user.id,
    ])
  } catch (err) {
    return { error: friendlyError(err) }
  }

  revalidatePath('/customers')
  return { ok: 'เปิดบัญชีให้ลูกค้าเข้าเว็บได้แล้ว' }
}

export async function toggleCustomerWebAction(formData: FormData) {
  await requireAdmin()
  await q(
    'update customers set web_enabled = not web_enabled where id = $1 and auth_user_id is not null',
    [int(formData, 'id')]
  )
  revalidatePath('/customers')
}

/* -------------------------------- ข่าวสาร -------------------------------- */

export async function saveNewsAction(formData: FormData): Promise<ActionState> {
  await requireAdmin()
  const id = str(formData, 'id')
  const title = str(formData, 'title')
  const body = optStr(formData, 'body')
  const imageUrl = optStr(formData, 'image_url')
  const linkUrl = optStr(formData, 'link_url')
  const isPublished = bool(formData, 'is_published')
  const pinned = bool(formData, 'pinned')

  if (!title) return { error: 'กรุณากรอกหัวข้อข่าว' }

  try {
    if (id) {
      await q(
        `update news set title = $1, body = $2, image_url = $3, link_url = $4,
                         is_published = $5, pinned = $6 where id = $7`,
        [title, body, imageUrl, linkUrl, isPublished, pinned, Number(id)]
      )
    } else {
      await q(
        `insert into news (title, body, image_url, link_url, is_published, pinned)
         values ($1, $2, $3, $4, $5, $6)`,
        [title, body, imageUrl, linkUrl, isPublished, pinned]
      )
    }
  } catch (err) {
    return { error: friendlyError(err) }
  }

  revalidatePath('/storefront')
  revalidatePath('/shop')
  if (id) redirect('/storefront')
  return { ok: `บันทึกข่าว "${title}" แล้ว` }
}

export async function deleteNewsAction(formData: FormData) {
  await requireAdmin()
  await q('delete from news where id = $1', [int(formData, 'id')])
  revalidatePath('/storefront')
  revalidatePath('/shop')
}

/* ----------------------------- ตั้งค่าหน้าเว็บ ----------------------------- */

export async function saveSiteSettingsAction(formData: FormData): Promise<ActionState> {
  await requireAdmin()
  try {
    for (const [key, value] of formData.entries()) {
      if (typeof value !== 'string') continue
      if (!key.startsWith('setting_')) continue
      await q(
        `insert into site_settings (key, value) values ($1, $2)
         on conflict (key) do update set value = excluded.value`,
        [key.replace('setting_', ''), value.trim()]
      )
    }
  } catch (err) {
    return { error: friendlyError(err) }
  }

  revalidatePath('/storefront')
  revalidatePath('/shop')
  return { ok: 'บันทึกการตั้งค่าหน้าเว็บแล้ว' }
}

/* --------------------------- ลูกค้ากดซื้อบนหน้าเว็บ --------------------------- */

export async function shopLoginAction(formData: FormData): Promise<ActionState> {
  const email = str(formData, 'email')
  const password = str(formData, 'password')
  if (!email || !password) return { error: 'กรุณากรอกอีเมลและรหัสผ่าน' }

  try {
    const supabase = await supabaseServer()
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' }

    const customer = await q1<{ id: number }>(
      'select id from customers where auth_user_id = $1 and web_enabled',
      [data.user.id]
    )
    if (!customer) {
      await supabase.auth.signOut()
      return { error: 'บัญชีนี้ยังไม่ได้เปิดใช้งานสำหรับหน้าเว็บ กรุณาติดต่อร้าน' }
    }
  } catch (err) {
    return { error: friendlyError(err, 'เข้าสู่ระบบไม่สำเร็จ') }
  }

  redirect('/shop/me')
}

export async function shopLogoutAction() {
  const supabase = await supabaseServer()
  await supabase.auth.signOut()
  redirect('/shop')
}

/**
 * ลูกค้ากดสั่งซื้อ — ตัดเครดิตแล้วออกบิลสถานะรอดำเนินการให้ร้านไปเติมให้
 * ตัดเครดิต ออกบิล บันทึกสมุดเครดิต และตัดสต๊อก อยู่ในคำสั่งเดียวกันทั้งหมด
 */
export async function shopOrderAction(formData: FormData): Promise<ActionState> {
  const customer = await getShopCustomer()
  if (!customer) return { error: 'กรุณาเข้าสู่ระบบก่อนสั่งซื้อ' }

  const productId = int(formData, 'product_id')
  const qty = Math.max(int(formData, 'qty', 1), 1)
  const gameAccount = str(formData, 'game_account')

  if (!productId) return { error: 'ไม่พบแพ็กเกจที่เลือก' }
  if (!gameAccount) return { error: 'กรุณากรอกไอดีเกมที่ต้องการเติม' }

  try {
    const product = await q1<{
      id: number
      game_id: number
      name: string
      sell_price: number
      cost_price: number
      track_stock: boolean
      stock_qty: number
    }>(
      `select id, game_id, name, sell_price::float8 as sell_price, cost_price::float8 as cost_price,
              track_stock, stock_qty
         from products where id = $1 and is_active and is_published`,
      [productId]
    )
    if (!product) return { error: 'แพ็กเกจนี้ปิดขายอยู่' }
    if (product.track_stock && product.stock_qty < qty) {
      return { error: `สินค้าเหลือไม่พอ (เหลือ ${product.stock_qty} ชิ้น)` }
    }

    const total = +(product.sell_price * qty).toFixed(2)
    const costTotal = +(product.cost_price * qty).toFixed(2)
    if (customer.credit < total) {
      return {
        error: `เครดิตไม่พอ ต้องใช้ ${total.toLocaleString('th-TH')} บาท แต่มี ${customer.credit.toLocaleString('th-TH')} บาท`,
      }
    }

    const code = `WEB-${Date.now().toString(36).toUpperCase()}`
    const rows = await q<{ code: string; balance_after: number }>(
      `with cust as (
         update customers set credit = credit - $1
          where id = $2 and credit >= $1
         returning id, credit
       ),
       s as (
         insert into sales (code, sold_at, customer_id, game_id, product_id, item_name,
                            game_account, qty, unit_price, unit_cost, total, cost_total, profit,
                            payment_method, status, channel, source, customer_name)
         select $3, now(), cust.id, $4, $5, $6, $7, $8, $9, $10, $1, $11, $1 - $11,
                'เครดิตร้าน', 'pending', 'web', 'เว็บไซต์', $12
           from cust
         returning id, code, product_id, qty, unit_cost
       ),
       tx as (
         insert into credit_transactions (customer_id, kind, amount, balance_after, note, sale_id)
         select cust.id, 'purchase', -$1, cust.credit, $6, s.id from cust, s
       ),
       upd as (
         update products set stock_qty = products.stock_qty - s.qty
           from s where products.id = s.product_id and products.track_stock
         returning products.id
       ),
       mv as (
         insert into stock_movements (product_id, kind, qty, unit_cost, note, sale_id)
         select s.product_id, 'out', s.qty, s.unit_cost, 'ลูกค้าสั่งซื้อผ่านหน้าเว็บ', s.id
           from s join products p on p.id = s.product_id where p.track_stock
       )
       select s.code, cust.credit::float8 as balance_after from s, cust`,
      [
        total,
        customer.id,
        code,
        product.game_id,
        product.id,
        product.name,
        gameAccount,
        qty,
        product.sell_price,
        product.cost_price,
        costTotal,
        customer.name,
      ]
    )

    if (rows.length === 0) return { error: 'เครดิตไม่พอ กรุณาลองใหม่' }

    revalidatePath('/shop/me')
    revalidatePath('/sales')
    revalidatePath('/')
    return {
      ok:
        `สั่งซื้อสำเร็จ เลขที่ ${rows[0].code} — ทางร้านกำลังดำเนินการเติมให้ ` +
        `เครดิตคงเหลือ ${rows[0].balance_after.toLocaleString('th-TH')} บาท`,
    }
  } catch (err) {
    return { error: friendlyError(err, 'สั่งซื้อไม่สำเร็จ') }
  }
}
