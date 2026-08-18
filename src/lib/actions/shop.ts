'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { q, q1 } from '@/lib/db'
import { requireAdmin, requirePage } from '@/lib/auth'
import {
  earnPointsPerBaht,
  getShopCustomer,
  getSiteSettings,
  isPartner,
  priceExpr,
  registrationOpen,
  SITE_KEYS,
} from '@/lib/shop'
import { SlipError, uploadImage } from '@/lib/storage'
import { autoDispatchOn, dispatchSale, markForDispatch } from '@/lib/dispatch'
import { jsonArray } from '@/lib/json'
import { supabaseAdmin, supabaseServer } from '@/lib/supabase'
import { bool, clip, customerError, decimal, friendlyError, int, optStr, str } from '@/lib/form'
import { tooMany, tooManyFromIp, TOO_MANY_MESSAGE } from '@/lib/ratelimit'
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
  const linkUrl = optStr(formData, 'link_url')
  const isPublished = bool(formData, 'is_published')
  const pinned = bool(formData, 'pinned')

  if (!title) return { error: 'กรุณากรอกหัวข้อข่าว' }

  try {
    // อัปโหลดรูปที่แนบมาก่อน ถ้าไม่ได้แนบก็ใช้ลิงก์ที่กรอกไว้
    const imageData = str(formData, 'image_data')
    let imageUrl = optStr(formData, 'image_url')
    if (imageData) imageUrl = await uploadImage(imageData, 'news')
    if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
      return { error: 'ลิงก์รูปต้องขึ้นต้นด้วย http:// หรือ https://' }
    }

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
    if (err instanceof SlipError) return { error: err.message }
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

    // ค่าที่เป็นรูป ถ้ามีไฟล์แนบมาให้อัปโหลดแล้วทับค่าเดิม
    for (const item of SITE_KEYS) {
      if (!('image' in item)) continue
      const data = str(formData, `${item.key}_data`)
      if (!data) continue
      const url = await uploadImage(data, 'site')
      await q(
        `insert into site_settings (key, value) values ($1, $2)
         on conflict (key) do update set value = excluded.value`,
        [item.key, url]
      )
    }
  } catch (err) {
    if (err instanceof SlipError) return { error: err.message }
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

  // กันเดารหัสผ่านของลูกค้า — บัญชีลูกค้ามีเครดิตอยู่ในนั้น ถ้าถูกเดาได้คือเสียเงินจริง
  if (await tooManyFromIp('shop-login', 10, 300)) return { error: TOO_MANY_MESSAGE }
  if (await tooMany(`shop-login:email:${email.toLowerCase()}`, 8, 900)) {
    return { error: TOO_MANY_MESSAGE }
  }

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
    return { error: customerError(err, 'เข้าสู่ระบบไม่สำเร็จ') }
  }

  redirect('/shop/me')
}

/**
 * ลูกค้าสมัครบัญชีเอง
 *
 * ถ้าเคยเป็นลูกค้าหน้าร้านอยู่แล้ว (มีเบอร์ตรงกันและยังไม่เคยผูกบัญชีเว็บ)
 * จะผูกเข้ากับรายชื่อเดิมให้เลย ยอดซื้อสะสมและเครดิตที่ร้านเติมไว้จะไม่หาย
 */
export async function shopRegisterAction(formData: FormData): Promise<ActionState> {
  const settings = await getSiteSettings()
  if (!registrationOpen(settings)) {
    return { error: 'ตอนนี้ร้านปิดรับสมัครเอง กรุณาติดต่อร้านเพื่อเปิดบัญชีให้' }
  }

  const email = str(formData, 'email')
  const password = str(formData, 'password')
  const confirm = str(formData, 'confirm')

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'กรุณากรอกอีเมลให้ถูกต้อง' }
  if (password.length < 8) return { error: 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร' }
  if (password !== confirm) return { error: 'รหัสผ่านสองช่องไม่ตรงกัน' }

  // การสมัครสร้างบัญชีด้วยสิทธิ์ service role จึงไม่ผ่านตัวกันสแปมของ Supabase
  // ต้องกันเองตรงนี้ ไม่งั้นโดนยิงสมัครเป็นพัน ๆ บัญชีจนรายชื่อลูกค้าเละ
  if (await tooManyFromIp('shop-register', 3, 3600)) return { error: TOO_MANY_MESSAGE }

  // ยังไม่ได้ถามชื่อตอนสมัคร ใช้ชื่อหน้าอีเมลไปก่อน ร้านแก้ทีหลังได้ที่เมนูรายชื่อลูกค้า
  const name = email.split('@')[0]

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // ใช้กับร้าน ไม่ต้องรอเมลยืนยัน
    })
    if (error || !data.user) {
      return {
        error: /already/i.test(error?.message ?? '')
          ? 'อีเมลนี้เคยสมัครไว้แล้ว ลองเข้าสู่ระบบ หรือติดต่อร้าน'
          : (error?.message ?? 'สมัครไม่สำเร็จ'),
      }
    }

    await q(
      `insert into customers (name, auth_user_id, web_enabled) values ($1, $2, true)`,
      [name, data.user.id]
    )

    const supabase = await supabaseServer()
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) return { error: 'สมัครสำเร็จแล้ว แต่เข้าสู่ระบบอัตโนมัติไม่ได้ กรุณาล็อกอินเอง' }

    revalidatePath('/customers')
  } catch (err) {
    return { error: customerError(err, 'สมัครไม่สำเร็จ') }
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
  // ต้องมีเพดานฝั่งเซิร์ฟเวอร์ด้วย ไม่ใช่แค่ในฟอร์ม เพราะค่าที่ส่งมาแก้ได้จากเบราว์เซอร์
  // ถ้าไม่จำกัด มีคนสั่ง 5,000 ชิ้นได้ ซึ่งเกินเพดาน 1,000 ของผู้ให้บริการ
  // ผลคือเครดิตถูกตัดไปแล้วแต่ปลายทางปฏิเสธ ต้องมาตามคืนเงินเอง
  const qty = Math.min(Math.max(int(formData, 'qty', 1), 1), 99)

  if (!productId) return { error: 'ไม่พบแพ็กเกจที่เลือก' }

  // กันกดสั่งรัว ๆ (เผลอกดซ้ำ หรือสคริปต์ยิงหลายรอบพร้อมกันเพื่อหวังให้ตัดเครดิตพลาด)
  if (await tooMany(`shop-order:customer:${customer.id}`, 20, 60)) {
    return { error: TOO_MANY_MESSAGE }
  }

  try {
    // ราคาคิดจากฐานข้อมูลตามระดับของลูกค้าเสมอ ไม่เคยเชื่อค่าที่ส่งมาจากฟอร์ม
    // (ฟอร์มแก้ได้จากฝั่งเบราว์เซอร์ ถ้าเชื่อก็เท่ากับให้ลูกค้าตั้งราคาเองได้)
    const product = await q1<{
      id: number
      game_id: number
      name: string
      sell_price: number
      cost_price: number
      track_stock: boolean
      stock_qty: number
      provider_fields: unknown
    }>(
      `select p.id, p.game_id, p.name, ${priceExpr(isPartner(customer))}::float8 as sell_price,
              p.cost_price::float8 as cost_price,
              p.track_stock, p.stock_qty, p.provider_fields
         from products p where p.id = $1 and p.is_active and p.is_published`,
      [productId]
    )
    if (!product) return { error: 'แพ็กเกจนี้ปิดขายอยู่' }

    // เกมที่ผู้ให้บริการบอกว่าต้องกรอกหลายช่อง (เช่นต้องเลือกเซิร์ฟเวอร์) ต้องเก็บให้ครบ
    // ตรวจที่ฝั่งเซิร์ฟเวอร์ด้วย เพราะ required ในฟอร์มเลี่ยงได้ง่าย
    // และถ้าส่งไปไม่ครบ ปลายทางอาจเติมเข้าผิดเซิร์ฟเวอร์ซึ่งเอาเงินคืนไม่ได้
    // ชุดที่ร้านตั้งเองรายเกมมาก่อน ต้องเป็นชุดเดียวกับที่หน้าเว็บแสดง
    // ไม่งั้นลูกค้ากรอกอย่างหนึ่ง แต่ระบบตรวจอีกอย่าง แล้วสั่งไม่ผ่านทั้งที่กรอกครบ
    // (ถามแยกและกลืน error เหมือนหน้าเว็บ กันกรณีฐานข้อมูลยังปรับโครงสร้างไม่เสร็จ)
    const override = await q1<{ provider_fields: unknown }>(
      'select provider_fields from games where id = $1',
      [product.game_id]
    ).catch(() => null)

    const spec =
      jsonArray<{ key: string; label: string }>(override?.provider_fields) ??
      jsonArray<{ key: string; label: string }>(product.provider_fields) ??
      []
    let fieldValues: Record<string, string> | null = null
    let gameAccount = ''

    if (spec.length > 0) {
      const values: Record<string, string> = {}
      for (const f of spec) {
        const v = str(formData, `field_${f.key}`)
        if (!v) return { error: `กรุณากรอก "${f.label || f.key}" ให้ครบ` }
        values[f.key] = clip(v, 120)
      }
      fieldValues = values
      // เก็บค่าหลักไว้ในช่องเดิมด้วย เพื่อให้หลังร้านค้นหาและอ่านบิลได้เหมือนเดิม
      gameAccount = values.uid ?? values.id_login ?? Object.values(values)[0] ?? ''
    } else {
      gameAccount = clip(str(formData, 'game_account'), 120)
    }

    if (!gameAccount) return { error: 'กรุณากรอกไอดีเกมที่ต้องการเติม' }
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

    // เครดิตที่แถมให้ตามยอดซื้อ ปัดลงเป็นจำนวนเต็มเสมอ แต้มไม่มีเศษ
    const earned = Math.floor(total * earnPointsPerBaht(await getSiteSettings()))

    const code = `WEB-${Date.now().toString(36).toUpperCase()}`
    const rows = await q<{
      sale_id: number
      code: string
      balance_after: number
      points_after: number
    }>(
      `with cust as (
         update customers
            set credit = credit - $1,
                points = points + $14
          where id = $2 and credit >= $1
         returning id, credit, points
       ),
       s as (
         insert into sales (code, sold_at, customer_id, game_id, product_id, item_name,
                            game_account, qty, unit_price, unit_cost, total, cost_total, profit,
                            payment_method, status, channel, source, customer_name, provider_fields,
                            points_earned)
         select $3, now(), cust.id, $4, $5, $6, $7, $8, $9, $10, $1, $11, $1 - $11,
                'เครดิตร้าน', 'pending', 'web', 'เว็บไซต์', $12, $13::jsonb, $14
           from cust
         returning id, code, product_id, qty, unit_cost
       ),
       tx as (
         insert into credit_transactions (customer_id, kind, amount, balance_after, note, sale_id)
         select cust.id, 'purchase', -$1, cust.credit, $6, s.id from cust, s
       ),
       ptx as (
         insert into point_transactions (customer_id, kind, points, balance_after, note)
         select cust.id, 'earn', $14, cust.points, 'เครดิตจากการซื้อ ' || s.code
           from cust, s where $14 > 0
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
       select s.id as sale_id, s.code, cust.credit::float8 as balance_after,
              cust.points::float8 as points_after from s, cust`,
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
        fieldValues ? JSON.stringify(fieldValues) : null,
        earned,
      ]
    )

    if (rows.length === 0) return { error: 'เครดิตไม่พอ กรุณาลองใหม่' }

    // ส่งออเดอร์ต่อไปยังผู้ให้บริการ
    // ห่อ try ไว้ทั้งก้อนเพราะเครดิตลูกค้าถูกตัดและออกบิลไปเรียบร้อยแล้ว
    // ถ้าขั้นนี้พลาด ห้ามทำให้การสั่งซื้อล้มตาม — บิลจะค้างในคิวแล้วระบบตามส่งให้เองทีหลัง
    let handoff = 'ทางร้านกำลังดำเนินการเติมให้'
    try {
      if (await markForDispatch(rows[0].sale_id)) {
        if (await autoDispatchOn()) {
          const outcome = await dispatchSale(rows[0].sale_id)
          if (outcome?.state === 'success') handoff = 'เติมเข้าเกมเรียบร้อยแล้ว'
          else if (outcome?.state === 'sent') handoff = 'ระบบกำลังเติมให้อัตโนมัติ รอสักครู่'
        }
      }
    } catch {
      // รายละเอียดปัญหาฝั่งผู้ให้บริการเป็นเรื่องหลังร้าน ไม่ต้องบอกลูกค้า
      // พนักงานจะเห็นสาเหตุเต็ม ๆ ที่หน้าลงยอดขาย
    }

    revalidatePath('/shop/me')
    revalidatePath('/sales')
    revalidatePath('/')
    return {
      ok:
        `สั่งซื้อสำเร็จ เลขที่ ${rows[0].code} — ${handoff} ` +
        `ยอดเงินคงเหลือ ${rows[0].balance_after.toLocaleString('th-TH')} บาท` +
        (earned > 0
          ? ` · ได้รับ ${earned.toLocaleString('th-TH')} เครดิต (รวมเป็น ${rows[0].points_after.toLocaleString('th-TH')})`
          : ''),
    }
  } catch (err) {
    return { error: customerError(err, 'สั่งซื้อไม่สำเร็จ') }
  }
}
