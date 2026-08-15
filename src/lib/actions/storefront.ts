'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { q } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { bool, friendlyError, int, optStr, str } from '@/lib/form'
import type { ActionState } from '@/components/ActionForm'

const AUTH_TYPES = ['bearer', 'apikey', 'basic', 'none']

/* --------------------------- ผู้ให้บริการ API --------------------------- */

export async function saveProviderAction(formData: FormData): Promise<ActionState> {
  await requireAdmin()
  const id = str(formData, 'id')
  const name = str(formData, 'name')
  const baseUrl = optStr(formData, 'base_url')
  const authType = AUTH_TYPES.includes(str(formData, 'auth_type'))
    ? str(formData, 'auth_type')
    : 'bearer'
  const apiKey = str(formData, 'api_key')
  const note = optStr(formData, 'note')
  const priority = int(formData, 'priority', 100)
  const isActive = bool(formData, 'is_active')

  if (!name) return { error: 'กรุณากรอกชื่อผู้ให้บริการ' }
  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
    return { error: 'ที่อยู่ API ต้องขึ้นต้นด้วย http:// หรือ https://' }
  }

  try {
    if (id) {
      // เว้นช่องคีย์ไว้ = ใช้คีย์เดิม ไม่ต้องพิมพ์ใหม่ทุกครั้งที่แก้ข้อมูลอื่น
      await q(
        `update api_providers
            set name = $1, base_url = $2, auth_type = $3, note = $4,
                priority = $5, is_active = $6,
                api_key = case when $7 = '' then api_key else $7 end
          where id = $8`,
        [name, baseUrl, authType, note, priority, isActive, apiKey, Number(id)]
      )
    } else {
      await q(
        `insert into api_providers (name, base_url, auth_type, api_key, note, priority, is_active)
         values ($1, $2, $3, nullif($4, ''), $5, $6, $7)`,
        [name, baseUrl, authType, apiKey, note, priority, isActive]
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

export async function toggleProductPublishedAction(formData: FormData) {
  await requireAdmin()
  await q('update products set is_published = not is_published where id = $1', [
    int(formData, 'id'),
  ])
  revalidatePath('/storefront')
  revalidatePath('/games')
}
