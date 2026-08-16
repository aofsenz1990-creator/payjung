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

/**
 * ย้ายแพ็กเกจทั้งหมดของเกมนี้ไปรวมกับอีกเกมหนึ่ง แล้วลบเกมที่ว่างทิ้ง
 *
 * ผู้ให้บริการแยกเกมเดียวกันออกเป็นหลายสินค้าตามประเทศ/ค่าเงิน
 * (เช่น OneOne THB / OneOne MYR / GOC) พอนำเข้ามาจึงกลายเป็นคนละเกมบนหน้าเว็บ
 * ลูกค้าเห็นชื่อเกมเดียวกันซ้ำ ๆ หลายใบแล้วงงว่าต้องกดอันไหน
 *
 * รวมแล้วหน้าเว็บจะขึ้นปุ่มให้เลือกประเภทเอง เพราะแต่ละแพ็กจำชื่อสินค้าต้นทาง
 * ไว้ที่ provider_variant และช่องที่ต้องกรอกก็ติดมากับแพ็กอยู่แล้ว
 */
/** ส่วนขึ้นต้นที่ทุกชื่อเหมือนกัน ใช้เดาชื่อเกมสะอาด ๆ ตอนรวม */
function commonPrefix(items: string[]) {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]
  let prefix = items[0]
  for (const s of items.slice(1)) {
    let i = 0
    while (i < prefix.length && i < s.length && prefix[i] === s[i]) i++
    prefix = prefix.slice(0, i)
    if (!prefix) break
  }
  return prefix
}

/** ตัดวงเล็บและอักขระคั่นที่ค้างอยู่ท้ายชื่อออก */
function cleanGameName(name: string) {
  return (
    name
      .replace(/\s*[([][^)\]]*[)\]]\s*$/, '')
      .replace(/[\s([–—\-:|/]+$/, '')
      .trim() || name.trim()
  )
}

export async function mergeGamesAction(formData: FormData): Promise<ActionState> {
  await requireAdmin()
  const ids = [
    ...new Set(
      formData
        .getAll('game_ids')
        .filter((v): v is string => typeof v === 'string')
        .map((v) => Number(v))
        .filter((n) => Number.isFinite(n) && n > 0)
    ),
  ]

  if (ids.length < 2) return { error: 'ติ๊กเลือกอย่างน้อย 2 เกมที่จะรวมเข้าด้วยกัน' }

  try {
    const holes = ids.map((_, i) => `$${i + 1}`).join(',')
    const games = await q<{
      id: number
      name: string
      image_url: string | null
      description: string | null
      publisher: string | null
      is_published: boolean
    }>(
      `select id, name, image_url, description, publisher, is_published
         from games where id in (${holes}) order by id`,
      ids
    )
    if (games.length < 2) return { error: 'ไม่พบเกมที่เลือก อาจถูกลบไปแล้ว' }

    // เก็บเกมที่มีรูปไว้เป็นตัวหลัก จะได้ไม่เสียรูปที่ตั้งไว้แล้ว
    // ถ้าไม่มีอันไหนมีรูปก็ใช้ตัวแรกสุด
    const target = games.find((g) => g.image_url) ?? games[0]
    const others = games.filter((g) => g.id !== target.id)

    // ชื่อที่จะโชว์บนหน้าเว็บควรเป็นชื่อเกมสะอาด ๆ ไม่ติดชื่อช่องทาง
    // ("Ragnarok : zero global" ไม่ใช่ "Ragnarok : zero global (GOC)")
    // ไม่ได้กรอกมาก็เดาจากส่วนที่ทุกชื่อเหมือนกัน
    // จำชื่อเกมเดิมไว้เป็นชื่อช่องทางก่อนทำอย่างอื่น
    //
    // ต้องทำตรงนี้เพราะแพ็กที่นำเข้ามาก่อนจะมีระบบช่องทางยังไม่มีค่านี้
    // ถ้าไม่เติมให้ พอรวมเสร็จหน้าเว็บจะไม่ขึ้นปุ่มเลือกช่องทาง แล้วแสดงทุกแพ็กปนกัน
    // และต้องทำ "ก่อนเปลี่ยนชื่อเกมหลัก" ไม่งั้นแพ็กของตัวหลักจะได้ชื่อใหม่ที่ไม่มีช่องทาง
    await q(
      `update products p
          set provider_variant = g.name
         from games g
        where g.id = p.game_id
          and p.game_id in (${holes})
          and p.provider_variant is null`,
      ids
    )

    const typed = optStr(formData, 'new_name')
    const guessed = cleanGameName(commonPrefix(games.map((g) => g.name)))
    // เดาได้สั้นเกินไป = ชื่อสองเกมไม่ได้เหมือนกันจริง (เช่น "Free Fire" กับ "Fortnite"
    // เหมือนกันแค่ตัว F) ถ้าเอามาใช้จะเปลี่ยนชื่อเกมเป็น "F" ซึ่งพังกว่าเดิม
    // กรณีแบบนี้ใช้ชื่อเดิมของตัวหลักไปก่อน แล้วให้คนพิมพ์เองถ้าอยากเปลี่ยน
    const usable = guessed.length >= 3 ? guessed : ''
    const newName = typed || usable

    // เช็กชนกับเกมอื่นที่ "ไม่ได้อยู่ในชุดที่กำลังรวม" ตัวที่อยู่ในชุดเดี๋ยวก็ถูกลบไป
    if (newName && newName !== target.name) {
      const exclude = ids.map((_, i) => `$${i + 2}`).join(',')
      const dup = await q1<{ id: number }>(
        `select id from games where lower(name) = lower($1) and id not in (${exclude})`,
        [newName, ...ids]
      )
      if (dup) return { error: `มีเกมชื่อ "${newName}" อยู่แล้ว ใช้ชื่ออื่นหรือติ๊กเกมนั้นมารวมด้วย` }
    }

    const fromIds = others.map((g) => g.id)
    const fromHoles = fromIds.map((_, i) => `$${i + 2}`).join(',')

    const moved = await q<{ id: number }>(
      `update products set game_id = $1 where game_id in (${fromHoles}) returning id`,
      [target.id, ...fromIds]
    )
    // บิลเก่ายังต้องชี้ไปที่เกมที่ยังอยู่ ไม่งั้นประวัติการขายจะไม่มีชื่อเกม
    await q(`update sales set game_id = $1 where game_id in (${fromHoles})`, [
      target.id,
      ...fromIds,
    ])
    await q(`delete from games where id in (${fromIds.map((_, i) => `$${i + 1}`).join(',')})`, fromIds)

    // เก็บของดีจากทุกเกมที่รวมมาไว้ที่ตัวหลัก
    // ถ้าตัวหลักบังเอิญเป็นตัวที่ยังไม่ได้เปิดขาย พอรวมเสร็จเกมจะหายจากหน้าเว็บทันที
    // ทั้งที่เมื่อกี้ยังขายอยู่ — เอาแบบมีตัวไหนเปิดอยู่ก็ถือว่าเปิด
    // ส่วนรูป/คำอธิบาย/ผู้ให้บริการ เติมจากตัวที่มีถ้าตัวหลักยังว่าง
    const pick = <K extends 'image_url' | 'description' | 'publisher'>(key: K) =>
      target[key] ?? games.find((g) => g[key])?.[key] ?? null

    // เปลี่ยนชื่อ "หลังลบเกมอื่นแล้ว" เท่านั้น
    //
    // ชื่อเกมห้ามซ้ำกันในฐานข้อมูล และชื่อที่จะตั้งมักเป็นชื่อของเกมตัวใดตัวหนึ่งในชุด
    // ที่กำลังรวมอยู่พอดี (เช่นรวม "X", "X (OneOne)", "X (Razer)" แล้วตั้งชื่อว่า "X")
    // ถ้าเปลี่ยนชื่อก่อนลบ จะไปชนกับตัวที่ยังไม่ถูกลบแล้วล้มทั้งคำสั่ง = กดรวมแล้วไม่มีอะไรเกิดขึ้น
    await q(
      `update games
          set name = $2, image_url = $3, description = $4, publisher = $5, is_published = $6
        where id = $1`,
      [
        target.id,
        newName || target.name,
        pick('image_url'),
        pick('description'),
        pick('publisher'),
        games.some((g) => g.is_published),
      ]
    )

    refreshProductViews(target.id)
    const shownName = newName || target.name
    return {
      ok:
        `รวม ${games.length} เกมเป็น "${shownName}" แล้ว — ` +
        `ย้ายมา ${moved.length} แพ็กเกจ · ` +
        'หน้าเว็บลูกค้าจะเห็นเป็นเกมเดียว แล้วเลือกช่องทางเติมในหน้าสั่งซื้อ' +
        (!typed && !usable
          ? ' · เดาชื่อกลางไม่ได้เพราะชื่อเกมต่างกันมาก จึงใช้ชื่อเดิม แก้ได้ที่ปุ่มแก้ไขเกม'
          : ''),
    }
  } catch (err) {
    return { error: friendlyError(err, 'รวมเกมไม่สำเร็จ') }
  }
}

/**
 * แยกช่องทางหนึ่งออกจากเกมที่รวมไว้ กลับไปเป็นเกมของตัวเอง — ใช้ตอนรวมผิด
 *
 * ทำได้เพราะตอนรวมเก็บชื่อเกมเดิมไว้ที่แต่ละแพ็ก (provider_variant) จึงรู้ว่า
 * แพ็กไหนเคยอยู่เกมไหน แยกกลับได้ตรงตัวโดยไม่ต้องเดา
 */
export async function splitVariantAction(formData: FormData): Promise<ActionState> {
  await requireAdmin()
  const gameId = int(formData, 'game_id')
  const variant = str(formData, 'variant')
  if (!gameId || !variant) return { error: 'ไม่พบช่องทางที่จะแยก' }

  try {
    // มีช่องทางเดียวก็ไม่ต้องแยก เพราะแยกแล้วเกมเดิมจะว่างเปล่า กลายเป็นแค่เปลี่ยนชื่อ
    const kinds = await q<{ v: string | null }>(
      'select distinct provider_variant as v from products where game_id = $1',
      [gameId]
    )
    if (kinds.length < 2) {
      return { error: 'เกมนี้มีช่องทางเดียวอยู่แล้ว ไม่ต้องแยก' }
    }

    const src = await q1<{
      publisher: string | null
      image_url: string | null
      description: string | null
      is_published: boolean
      sort_order: number
    }>(
      'select publisher, image_url, description, is_published, sort_order from games where id = $1',
      [gameId]
    )
    if (!src) return { error: 'ไม่พบเกมนี้' }

    // มีเกมชื่อนี้อยู่แล้วก็ย้ายเข้าไปรวม ไม่งั้นสร้างใหม่
    // ยกรูปและคำอธิบายจากเกมต้นทางมาด้วย จะได้ไม่ต้องมาตั้งใหม่ทั้งหมด
    let target = await q1<{ id: number }>(
      'select id from games where lower(name) = lower($1)',
      [variant]
    )
    if (!target) {
      const created = await q<{ id: number }>(
        `insert into games (name, publisher, image_url, description, is_published, sort_order)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [variant, src.publisher, src.image_url, src.description, src.is_published, src.sort_order]
      )
      target = created[0]
    }

    const moved = await q<{ id: number }>(
      `update products set game_id = $2
        where game_id = $1 and provider_variant = $3
       returning id`,
      [gameId, target.id, variant]
    )
    if (moved.length === 0) return { error: 'ไม่พบแพ็กเกจของช่องทางนี้' }

    // ย้ายบิลตาม "แพ็กที่ย้าย" ไม่ใช่ย้ายทั้งเกม เพราะบิลของช่องทางอื่นต้องอยู่ที่เดิม
    const ids = moved.map((m) => m.id)
    const holes = ids.map((_, i) => `$${i + 2}`).join(',')
    await q(`update sales set game_id = $1 where product_id in (${holes})`, [target.id, ...ids])

    refreshProductViews(gameId)
    refreshProductViews(target.id)
    return {
      ok:
        `แยก "${variant}" ออกเป็นเกมของตัวเองแล้ว — ย้ายไป ${moved.length} แพ็กเกจ · ` +
        'ราคาและการตั้งค่าของแต่ละแพ็กยังอยู่ครบเหมือนเดิม',
    }
  } catch (err) {
    return { error: friendlyError(err, 'แยกช่องทางไม่สำเร็จ') }
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
