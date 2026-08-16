'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { q, q1 } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { BuymError, getProducts } from '@/lib/providers/24buym'
import { PROVIDER_KINDS, providerMeta } from '@/lib/providers/constants'
import { adapterFor, supportsAuto, toConfig } from '@/lib/providers/registry'
import { ProviderError } from '@/lib/providers/types'
import { bool, friendlyError, int, optStr, str } from '@/lib/form'
import type { ActionState } from '@/components/ActionForm'

const AUTH_TYPES = ['bearer', 'apikey', 'basic', 'none']

/**
 * ทดสอบว่าคีย์ใช้งานได้จริงไหม โดยเรียก endpoint ดูข้อมูลบัญชี
 * คีย์ไม่เคยออกจากฝั่งเซิร์ฟเวอร์ ผลลัพธ์ที่ส่งกลับมีแค่ชื่อบัญชีกับเครดิตคงเหลือ
 */
export async function testProviderAction(formData: FormData): Promise<ActionState> {
  await requireAdmin()
  const id = int(formData, 'id')
  if (!id) return { error: 'กรุณาเลือกผู้ให้บริการ' }

  const provider = await q1<{
    id: number
    name: string
    base_url: string | null
    username: string | null
    api_key: string | null
    kind: string
    sandbox: boolean
  }>(
    'select id, name, base_url, username, api_key, kind, sandbox from api_providers where id = $1',
    [id]
  )

  if (!provider) return { error: 'ไม่พบผู้ให้บริการนี้' }
  if (!provider.api_key) {
    return { error: `"${provider.name}" ยังไม่ได้ตั้งคีย์/รหัสผ่าน — กดแก้ไขแล้วกรอกก่อน` }
  }
  if (!supportsAuto(provider.kind)) {
    return { error: `ยังไม่ได้เขียนตัวเชื่อมของชนิด "${provider.kind}" จึงทดสอบอัตโนมัติไม่ได้` }
  }

  try {
    // เช็กยอดคงเหลือเป็นตัวทดสอบมาตรฐาน — ผ่านแปลว่า ID/คีย์ถูกและ IP ไม่ถูกบล็อก
    const config = toConfig(provider)
    const wallet = await adapterFor(provider.kind).getBalance(config)
    // จำยอดที่เพิ่งได้ไว้ จะได้ไม่ต้องยิงถามซ้ำตอนลูกค้ากดซื้อ
    await q('update api_providers set balance = $2, balance_at = now() where id = $1', [
      provider.id,
      wallet.balance,
    ])

    let extra = ''
    // 24BUYM ทดสอบดึงรายการสินค้าได้ด้วย จะได้รู้ว่าคีย์ใช้ได้ครบทุกสิทธิ์
    if (provider.kind === '24buym') {
      const products = await getProducts(provider.base_url, provider.api_key)
      const games = products.products?.length ?? 0
      const packs = (products.products ?? []).reduce((a, g) => a + (g.packages?.length ?? 0), 0)
      extra = ` — ดึงรายการสินค้าได้ ${games} เกม ${packs} แพ็กเกจ`
    }

    revalidatePath('/storefront')
    return {
      ok:
        `เชื่อมต่อสำเร็จ ✓ ${provider.name}` +
        (wallet.account ? ` บัญชี "${wallet.account}"` : '') +
        ` เหลือ ${wallet.balance.toLocaleString('th-TH')} ${wallet.unit}${extra}`,
    }
  } catch (err) {
    if (err instanceof ProviderError) return { error: err.message }
    if (err instanceof BuymError) return { error: err.message }
    return { error: friendlyError(err, 'ทดสอบการเชื่อมต่อไม่สำเร็จ') }
  }
}

/* --------------------------- ผู้ให้บริการ API --------------------------- */

export async function saveProviderAction(formData: FormData): Promise<ActionState> {
  await requireAdmin()
  const id = str(formData, 'id')
  const name = str(formData, 'name')
  const baseUrl = optStr(formData, 'base_url')
  const authType = AUTH_TYPES.includes(str(formData, 'auth_type'))
    ? str(formData, 'auth_type')
    : 'bearer'
  const kind = PROVIDER_KINDS.includes(str(formData, 'kind')) ? str(formData, 'kind') : 'custom'
  const apiKey = str(formData, 'api_key')
  const username = optStr(formData, 'username')
  const note = optStr(formData, 'note')
  const priority = int(formData, 'priority', 100)
  const isActive = bool(formData, 'is_active')
  const sandbox = bool(formData, 'sandbox')

  if (!name) return { error: 'กรุณากรอกชื่อผู้ให้บริการ' }
  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
    return { error: 'ที่อยู่ API ต้องขึ้นต้นด้วย http:// หรือ https://' }
  }
  if (providerMeta(kind).needsUsername && !username) {
    return { error: 'เจ้านี้ต้องกรอก ID ผู้ใช้ที่ผู้ให้บริการออกให้ด้วย' }
  }

  try {
    if (id) {
      // เว้นช่องคีย์/รหัสผ่านไว้ = ใช้ค่าเดิม ไม่ต้องพิมพ์ใหม่ทุกครั้งที่แก้ข้อมูลอื่น
      await q(
        `update api_providers
            set name = $1, base_url = $2, auth_type = $3, note = $4,
                priority = $5, is_active = $6, kind = $9, username = $10, sandbox = $11,
                api_key = case when $7 = '' then api_key else $7 end
          where id = $8`,
        [
          name, baseUrl, authType, note, priority, isActive, apiKey, Number(id), kind,
          username, sandbox,
        ]
      )
    } else {
      await q(
        `insert into api_providers
           (name, base_url, auth_type, api_key, note, priority, is_active, kind, username, sandbox)
         values ($1, $2, $3, nullif($4, ''), $5, $6, $7, $8, $9, $10)`,
        [name, baseUrl, authType, apiKey, note, priority, isActive, kind, username, sandbox]
      )
    }
  } catch (err) {
    return { error: friendlyError(err) }
  }

  revalidatePath('/storefront')
  if (id) redirect('/storefront')
  return { ok: `บันทึกผู้ให้บริการ "${name}" แล้ว` }
}

export async function deleteProviderAction(formData: FormData) {
  await requireAdmin()
  // แพ็กเกจที่ผูกไว้จะกลายเป็นยังไม่ได้เลือกผู้ให้บริการ (on delete set null)
  await q('delete from api_providers where id = $1', [int(formData, 'id')])
  revalidatePath('/storefront')
  revalidatePath('/games')
}

/* ----------------------- หน้าเว็บของแต่ละเกม ----------------------- */

export async function saveGameStorefrontAction(formData: FormData): Promise<ActionState> {
  await requireAdmin()
  const id = int(formData, 'id')
  const imageUrl = optStr(formData, 'image_url')
  const description = optStr(formData, 'description')
  const sortOrder = int(formData, 'sort_order', 100)
  const isPublished = bool(formData, 'is_published')

  if (!id) return { error: 'ไม่พบเกมนี้' }
  if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
    return { error: 'ลิงก์รูปต้องขึ้นต้นด้วย http:// หรือ https://' }
  }

  try {
    await q(
      `update games set image_url = $1, description = $2, sort_order = $3, is_published = $4
        where id = $5`,
      [imageUrl, description, sortOrder, isPublished, id]
    )
  } catch (err) {
    return { error: friendlyError(err) }
  }

  revalidatePath('/storefront')
  revalidatePath('/games')
  return { ok: 'บันทึกการตั้งค่าหน้าเว็บแล้ว' }
}

/** เปิด/ปิดการแสดงเกมบนหน้าเว็บลูกค้าแบบเร็ว ๆ จากในตาราง */
export async function toggleGamePublishedAction(formData: FormData) {
  await requireAdmin()
  await q('update games set is_published = not is_published where id = $1', [
    int(formData, 'id'),
  ])
  revalidatePath('/storefront')
}

/**
 * เปิดขาย/ซ่อนแพ็กเกจทั้งหมดในทีเดียว
 * ทำเฉพาะแพ็กเกจ ไม่ไปยุ่งกับการเปิด-ปิดตัวเกม เพราะเป็นคนละเรื่องกัน
 * แต่จะเตือนให้ถ้ายังมีเกมที่ซ่อนอยู่ เพราะเปิดแพ็กเกจอย่างเดียวลูกค้าก็ยังไม่เห็น
 */
export async function setAllProductsPublishedAction(formData: FormData): Promise<ActionState> {
  await requireAdmin()
  const published = str(formData, 'published') === '1'

  try {
    const rows = await q<{ changed: number; hidden_games: number }>(
      `with upd as (
         update products set is_published = $1
          where is_active and is_published <> $1
         returning id
       )
       select (select count(*) from upd)::int as changed,
              (select count(*) from games g
                where g.is_active and not g.is_published
                  and exists (select 1 from products p
                               where p.game_id = g.id and p.is_active))::int as hidden_games`,
      [published]
    )

    const changed = rows[0]?.changed ?? 0
    const hiddenGames = rows[0]?.hidden_games ?? 0

    revalidatePath('/storefront')
    revalidatePath('/games')
    revalidatePath('/shop')

    if (changed === 0) {
      return { ok: published ? 'ทุกแพ็กเกจเปิดขายอยู่แล้ว' : 'ทุกแพ็กเกจซ่อนอยู่แล้ว' }
    }
    return {
      ok:
        `${published ? 'เปิดขาย' : 'ซ่อน'} ${changed} แพ็กเกจแล้ว` +
        (published && hiddenGames > 0
          ? ` — แต่ยังมี ${hiddenGames} เกมที่ซ่อนอยู่ ลูกค้าจะยังไม่เห็นแพ็กเกจของเกมนั้น กดปุ่ม "แสดง" ที่ตารางเกมด้านบนด้วย`
          : ''),
    }
  } catch (err) {
    return { error: friendlyError(err) }
  }
}

export async function toggleProductPublishedAction(formData: FormData) {
  await requireAdmin()
  await q('update products set is_published = not is_published where id = $1', [
    int(formData, 'id'),
  ])
  revalidatePath('/storefront')
  revalidatePath('/games')
}
