import 'server-only'
import { cache } from 'react'
import { q, q1 } from './db'
import { supabaseServer } from './supabase'

/** ค่าตั้งค่าหน้าเว็บที่แก้ได้จากหลังร้าน */
export const SITE_KEYS = [
  { key: 'shop_tagline', label: 'ข้อความใต้ชื่อร้าน', placeholder: 'เติมเกมไว ราคาถูก บริการ 24 ชม.' },
  { key: 'announcement', label: 'ประกาศแถบบนสุด', placeholder: 'เว้นว่างถ้าไม่ต้องการแสดง' },
  { key: 'contact_line', label: 'LINE', placeholder: '@payjung' },
  { key: 'contact_facebook', label: 'Facebook', placeholder: 'https://facebook.com/payjung' },
  { key: 'contact_phone', label: 'เบอร์โทร', placeholder: '08x-xxx-xxxx' },
  { key: 'contact_note', label: 'เวลาทำการ / หมายเหตุ', placeholder: 'เปิดทุกวัน 09:00 - 22:00' },
] as const

export type SiteSettings = Record<string, string>

export const getSiteSettings = cache(async function getSiteSettings(): Promise<SiteSettings> {
  const rows = await q<{ key: string; value: string | null }>('select key, value from site_settings')
  const out: SiteSettings = {}
  for (const r of rows) if (r.value) out[r.key] = r.value
  return out
})

export type ShopCustomer = {
  id: number
  name: string
  credit: number
  phone: string | null
  game_uid: string | null
  email: string
}

/**
 * ลูกค้าที่ล็อกอินอยู่บนหน้าเว็บ
 * ใช้ Supabase Auth ตัวเดียวกับพนักงาน แต่แยกกันด้วยว่ามีแถวใน customers ไหม
 * ร้านเป็นคนสร้างบัญชีให้ ลูกค้าสมัครเองไม่ได้
 */
export const getShopCustomer = cache(async function getShopCustomer(): Promise<ShopCustomer | null> {
  try {
    const supabase = await supabaseServer()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return null

    const row = await q1<Omit<ShopCustomer, 'email'>>(
      `select id, name, credit::float8 as credit, phone, game_uid
         from customers where auth_user_id = $1 and web_enabled limit 1`,
      [user.id]
    )
    if (!row) return null
    return { ...row, email: user.email ?? '' }
  } catch {
    // ยังตั้งค่าไม่ครบ หรือฐานข้อมูลมีปัญหา — ถือว่ายังไม่ล็อกอิน
    return null
  }
})
