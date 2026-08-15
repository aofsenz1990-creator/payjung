'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { q } from '@/lib/db'
import { requireAdmin, requirePage } from '@/lib/auth'
import { bool, decimal, friendlyError, int, optStr, str } from '@/lib/form'
import type { ActionState } from '@/components/ActionForm'

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
    if (id) {
      await q('update games set name = $1, publisher = $2, note = $3, is_active = $4 where id = $5', [
        name,
        publisher,
        note,
        isActive,
        Number(id),
      ])
    } else {
      await q('insert into games (name, publisher, note) values ($1, $2, $3)', [
        name,
        publisher,
        note,
      ])
    }
  } catch (err) {
    return { error: friendlyError(err) }
  }

  revalidatePath('/games')
  if (id) redirect('/games')
  return { ok: `บันทึกเกม "${name}" แล้ว` }
}

export async function deleteGameAction(formData: FormData) {
  await requireAdmin()
  const id = int(formData, 'id')
  // ลบเกม = ลบแพ็กเกจของเกมนั้นด้วย (on delete cascade) แต่บิลขายเก่ายังอยู่ครบ
  await q('delete from games where id = $1', [id])
  revalidatePath('/games')
  revalidatePath('/stock')
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

  if (!gameId) return { error: 'กรุณาเลือกเกม' }
  if (!name) return { error: 'กรุณากรอกชื่อแพ็กเกจ เช่น 100 เพชร' }
  if (price < 0 || cost < 0) return { error: 'ราคาต้องไม่ติดลบ' }

  try {
    if (id) {
      await q(
        `update products set game_id = $1, name = $2, sku = $3, cost_price = $4, sell_price = $5,
           track_stock = $6, low_stock = $7, is_active = $8, image_url = $10,
           is_published = $11, sort_order = $12, provider_id = $13, provider_sku = $14
         where id = $9`,
        [
          gameId, name, sku, cost, price, trackStock, lowStock, isActive, Number(id),
          imageUrl, isPublished, sortOrder, providerId, providerSku,
        ]
      )
    } else {
      const openingQty = int(formData, 'opening_qty')
      const rows = await q<{ id: number }>(
        `insert into products (game_id, name, sku, cost_price, sell_price, track_stock, low_stock,
                               stock_qty, image_url, is_published, sort_order, provider_id, provider_sku)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id`,
        [
          gameId, name, sku, cost, price, trackStock, lowStock, trackStock ? openingQty : 0,
          imageUrl, isPublished, sortOrder, providerId, providerSku,
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

  revalidatePath('/games')
  revalidatePath('/stock')
  revalidatePath('/storefront')
  if (id) redirect(`/games/${gameId}`)
  return { ok: `บันทึกแพ็กเกจ "${name}" แล้ว` }
}

export async function deleteProductAction(formData: FormData) {
  await requireAdmin()
  const id = int(formData, 'id')
  await q('delete from products where id = $1', [id])
  revalidatePath('/games')
  revalidatePath('/stock')
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
