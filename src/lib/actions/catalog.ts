'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { q, q1 } from '@/lib/db'
import { requireAdmin, requirePage } from '@/lib/auth'
import { SlipError, uploadImage } from '@/lib/storage'
import { bool, decimal, friendlyError, int, optStr, str } from '@/lib/form'
import type { ActionState } from '@/components/ActionForm'

/**
 * สั่งรีเฟรชทุกหน้าที่แสดงข้อมูลแพ็กเกจ
 *
 * ที่ต้องมีตัวช่วยนี้เพราะเคยลืมใส่หน้า /games/[id] ซึ่งเป็นหน้าที่ผู้ใช้ยืนอยู่จริง
 * ตอนกดบันทึก ผลคือบันทึกผ่านแล้วแต่ตารางไม่ขยับ ต้องกด F5 เอง
 *
 * รูปแบบ '/games/[id]' คือสั่งรีเฟรชทุกเกม ใช้ตอนที่ไม่รู้ว่าแพ็กนั้นอยู่เกมไหน
 */
function refreshProductViews(gameId?: number | null) {
  revalidatePath('/games')
  revalidatePath('/stock')
  revalidatePath('/storefront')
  revalidatePath('/shop')
  if (gameId) {
    revalidatePath(`/games/${gameId}`)
    revalidatePath(`/shop/game/${gameId}`)
  } else {
    revalidatePath('/games/[id]', 'page')
    revalidatePath('/shop/game/[id]', 'page')
  }
}

/* ---------------------------------- เกม ---------------------------------- */

export async function saveGameAction(formData: FormData): Promise<ActionState> {
  await requirePage('games')
  const id = str(formData, 'id')
  const name = str(formData, 'name')
  const publisher = optStr(formData, 'publisher')
  const note = optStr(formData, 'note')
  const isActive = bool(formData, 'is_active')

  if (!name) return { error: 'กรุณากรอกชื่อเกม' }

  try {
    // อัปโหลดรูปที่แนบมาก่อน ถ้าไม่ได้แนบก็ใช้ลิงก์ที่กรอกไว้
    const imageData = str(formData, 'image_data')
    let imageUrl = optStr(formData, 'image_url')
    if (imageData) imageUrl = await uploadImage(imageData, 'games')
    if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
      return { error: 'ลิงก์รูปต้องขึ้นต้นด้วย http:// หรือ https://' }
    }

    if (id) {
      await q(
        `update games set name = $1, publisher = $2, note = $3, is_active = $4, image_url = $6
          where id = $5`,
        [name, publisher, note, isActive, Number(id), imageUrl]
      )
    } else {
      await q('insert into games (name, publisher, note, image_url) values ($1, $2, $3, $4)', [
        name,
        publisher,
        note,
        imageUrl,
      ])
    }
  } catch (err) {
    if (err instanceof SlipError) return { error: err.message }
    return { error: friendlyError(err) }
  }

  revalidatePath('/games')
  revalidatePath('/storefront')
  revalidatePath('/shop')
  if (id) redirect('/games')
  return { ok: `บันทึกเกม "${name}" แล้ว` }
}

export async function deleteGameAction(formData: FormData) {
  await requireAdmin()
  const id = int(formData, 'id')
  // ลบเกม = ลบแพ็กเกจของเกมนั้นด้วย (on delete cascade) แต่บิลขายเก่ายังอยู่ครบ
  await q('delete from games where id = $1', [id])
  refreshProductViews(id)
}

/* -------------------------------- แพ็กเกจเติม ------------------------------- */

export async function saveProductAction(formData: FormData): Promise<ActionState> {
  await requirePage('games')
  const id = str(formData, 'id')
  const gameId = int(formData, 'game_id')
  const name = str(formData, 'name')
  const sku = optStr(formData, 'sku')
  const cost = decimal(formData, 'cost_price')
  const price = decimal(formData, 'sell_price')
  const trackStock = bool(formData, 'track_stock')
  const lowStock = int(formData, 'low_stock')
  const isActive = bool(formData, 'is_active')
  // ข้อมูลสำหรับหน้าเว็บลูกค้า
  const imageUrl = optStr(formData, 'image_url')
  const isPublished = bool(formData, 'is_published')
  const sortOrder = int(formData, 'sort_order', 100)
  const providerId = str(formData, 'provider_id') ? int(formData, 'provider_id') : null
  const providerSku = optStr(formData, 'provider_sku')
  const providerProductType = optStr(formData, 'provider_product_type')
  // กรอก % ไว้ = ให้ระบบคิดราคาขายจากต้นทุนให้เอง เว้นว่าง = ตั้งราคาขายเอง
  const markupRaw = optStr(formData, 'markup_percent')
  const markup = markupRaw === null ? null : decimal(formData, 'markup_percent')

  if (!gameId) return { error: 'กรุณาเลือกเกม' }
  if (!name) return { error: 'กรุณากรอกชื่อแพ็กเกจ เช่น 100 เพชร' }
  if (price < 0 || cost < 0) return { error: 'ราคาต้องไม่ติดลบ' }
  if (markup !== null && markup < 0) return { error: 'เปอร์เซ็นต์กำไรต้องไม่ติดลบ' }

  try {
    if (id) {
      await q(
        // ตั้ง % ไว้เมื่อไหร่ ราคาขายมาจากการคำนวณเสมอ ไม่ใช่ค่าที่พิมพ์ในช่องราคาขาย
        // ปัดขึ้นเป็นจำนวนเต็มบาท (ceil) ไม่ใช่ปัดใกล้สุด เพราะปัดลงจะทำให้กำไรต่ำกว่าที่ตั้งไว้
        `update products set game_id = $1, name = $2, sku = $3, cost_price = $4,
           sell_price = case when $16::numeric is null then $5
                             else ceil($4::numeric * (1 + $16::numeric / 100)) end,
           markup_percent = $16,
           track_stock = $6, low_stock = $7, is_active = $8, image_url = $10,
           is_published = $11, sort_order = $12, provider_id = $13, provider_sku = $14,
           provider_product_type = $15
         where id = $9`,
        [
          gameId, name, sku, cost, price, trackStock, lowStock, isActive, Number(id),
          imageUrl, isPublished, sortOrder, providerId, providerSku, providerProductType, markup,
        ]
      )
    } else {
      const openingQty = int(formData, 'opening_qty')
      const rows = await q<{ id: number }>(
        `insert into products (game_id, name, sku, cost_price, sell_price, track_stock, low_stock,
                               stock_qty, image_url, is_published, sort_order, provider_id, provider_sku,
                               provider_product_type, markup_percent)
         values ($1, $2, $3, $4,
                 case when $15::numeric is null then $5
                      else ceil($4::numeric * (1 + $15::numeric / 100)) end,
                 $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) returning id`,
        [
          gameId, name, sku, cost, price, trackStock, lowStock, trackStock ? openingQty : 0,
          imageUrl, isPublished, sortOrder, providerId, providerSku, providerProductType, markup,
        ]
      )
      if (trackStock && openingQty > 0) {
        await q(
          `insert into stock_movements (product_id, kind, qty, unit_cost, note)
           values ($1, 'in', $2, $3, 'ยอดยกมาตอนสร้างแพ็กเกจ')`,
          [rows[0].id, openingQty, cost]
        )
      }
    }
  } catch (err) {
    return { error: friendlyError(err) }
  }

  refreshProductViews(gameId)
  if (id) redirect(`/games/${gameId}`)
  return { ok: `บันทึกแพ็กเกจ "${name}" แล้ว` }
}

/**
 * ตั้งกำไรเป็นเปอร์เซ็นต์ให้ทุกแพ็กเกจในเกมเดียวทีเดียว
 * ใช้ตอนเพิ่งนำเข้าเกมมาแล้วราคาขายยังเท่าทุนอยู่ทั้งหมด
 *
 * ตั้ง % ไว้แล้วราคาขายจะคิดใหม่ให้เองทุกครั้งที่ต้นทุนเปลี่ยน
 * เช่นผู้ให้บริการขึ้นราคาแล้วเราดึงรายการใหม่ กำไรจะยังเท่าเดิมโดยไม่ต้องไล่แก้ทีละแพ็ก
 */
export async function setGameMarkupAction(formData: FormData): Promise<ActionState> {
  await requirePage('games')
  const gameId = int(formData, 'game_id')
  if (!gameId) return { error: 'ไม่พบเกมนี้' }

  // กดปุ่มล้าง = เลิกคิดอัตโนมัติ แต่ราคาขายที่ตั้งไว้แล้วคงเดิม ไม่ตีกลับเป็นเท่าทุน
  if (str(formData, 'clear') === '1') {
    await q('update products set markup_percent = null where game_id = $1', [gameId])
    revalidatePath(`/games/${gameId}`)
    return { ok: 'เลิกคิดราคาขายอัตโนมัติแล้ว — ราคาที่ตั้งไว้ยังอยู่เหมือนเดิม' }
  }

  const raw = optStr(formData, 'markup_percent')
  if (raw === null) return { error: 'กรุณากรอกเปอร์เซ็นต์กำไร' }
  const percent = decimal(formData, 'markup_percent')
  if (percent < 0) return { error: 'เปอร์เซ็นต์กำไรต้องไม่ติดลบ' }

  try {
    const rows = await q<{ id: number }>(
      `update products
          set markup_percent = $2,
              sell_price = ceil(cost_price * (1 + $2::numeric / 100))
        where game_id = $1
       returning id`,
      [gameId, percent]
    )

    revalidatePath(`/games/${gameId}`)
    revalidatePath('/games')
    revalidatePath('/storefront')
    revalidatePath('/shop')
    return {
      ok:
        `ตั้งกำไร ${percent}% ให้ ${rows.length} แพ็กเกจแล้ว — ` +
        'ถ้าต้นทุนเปลี่ยนทีหลัง ราคาขายจะคิดใหม่ให้เองโดยกำไรเท่าเดิม',
    }
  } catch (err) {
    return { error: friendlyError(err, 'ตั้งราคาขายไม่สำเร็จ') }
  }
}

/**
 * เปิด/ปิดขายบนหน้าเว็บลูกค้าทั้งเกมทีเดียว (ทั้งตัวเกมและทุกแพ็กเกจ)
 *
 * ต้องเปิดทั้งสองอย่างถึงจะเห็นบนเว็บ เพราะหน้าเว็บกรองด้วย
 * games.is_published และ products.is_published พร้อมกัน
 * เปิดแค่แพ็กเกจแต่ลืมเปิดเกม = ลูกค้ายังไม่เห็นอะไรเลย ซึ่งหาสาเหตุยากมาก
 */
export async function setGamePublishedAction(formData: FormData): Promise<ActionState> {
  await requirePage('games')
  const gameId = int(formData, 'game_id')
  const published = str(formData, 'published') === '1'
  if (!gameId) return { error: 'ไม่พบเกมนี้' }

  try {
    const rows = await q<{ n: number }>(
      `with g as (
         update games set is_published = $2 where id = $1 returning id
       ),
       p as (
         update products set is_published = $2
           from g where products.game_id = g.id and products.is_active
         returning products.id
       )
       select count(*)::int as n from p`,
      [gameId, published]
    )
    const n = rows[0]?.n ?? 0

    revalidatePath(`/games/${gameId}`)
    revalidatePath('/games')
    revalidatePath('/storefront')
    revalidatePath('/shop')
    return {
      ok: published
        ? `เปิดขายบนหน้าเว็บแล้ว — ลูกค้าเห็นเกมนี้พร้อม ${n} แพ็กเกจ`
        : `ซ่อนจากหน้าเว็บแล้ว — ลูกค้าจะไม่เห็นเกมนี้และ ${n} แพ็กเกจของมัน`,
    }
  } catch (err) {
    return { error: friendlyError(err, 'เปลี่ยนสถานะบนเว็บไม่สำเร็จ') }
  }
}

export async function deleteProductAction(formData: FormData) {
  await requireAdmin()
  const id = int(formData, 'id')
  // เอาเกมของแพ็กนี้ไว้ก่อนลบ จะได้สั่งรีเฟรชหน้าเกมนั้นได้ตรงตัว
  const row = await q1<{ game_id: number }>('select game_id from products where id = $1', [id])
  await q('delete from products where id = $1', [id])
  refreshProductViews(row?.game_id)
}

/* --------------------------------- ลูกค้า --------------------------------- */

export async function saveCustomerAction(formData: FormData): Promise<ActionState> {
  await requirePage('customers')
  const id = str(formData, 'id')
  const name = str(formData, 'name')
  const phone = optStr(formData, 'phone')
  const contact = optStr(formData, 'contact')
  const gameUid = optStr(formData, 'game_uid')
  const note = optStr(formData, 'note')

  if (!name) return { error: 'กรุณากรอกชื่อลูกค้า' }

  try {
    if (id) {
      await q(
        'update customers set name = $1, phone = $2, contact = $3, game_uid = $4, note = $5 where id = $6',
        [name, phone, contact, gameUid, note, Number(id)]
      )
    } else {
      await q(
        'insert into customers (name, phone, contact, game_uid, note) values ($1, $2, $3, $4, $5)',
        [name, phone, contact, gameUid, note]
      )
    }
  } catch (err) {
    return { error: friendlyError(err) }
  }

  revalidatePath('/customers')
  if (id) redirect('/customers')
  return { ok: `บันทึกลูกค้า "${name}" แล้ว` }
}

export async function deleteCustomerAction(formData: FormData) {
  await requireAdmin()
  const id = int(formData, 'id')
  // บิลขายเก่ายังอยู่ แต่จะกลายเป็น "ลูกค้าทั่วไป" (customer_id = null)
  await q('delete from customers where id = $1', [id])
  revalidatePath('/customers')
}
