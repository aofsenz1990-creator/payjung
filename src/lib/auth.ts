import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { ConfigError, q, q1 } from './db'
import { supabaseServer, SupabaseConfigError } from './supabase'

import { landingHref, resolvePages, type PageKey } from './pages'

export type Role = 'admin' | 'staff'

export type SessionUser = {
  id: string // uuid เดียวกับ auth.users.id ของ Supabase
  email: string
  name: string
  role: Role
  /** เมนูที่เข้าถึงได้จริง คำนวณจากสิทธิ์ + การกำหนดรายคนแล้ว */
  pages: PageKey[]
}

/** แปลงค่าที่เก็บเป็นข้อความคั่นจุลภาคกลับเป็น array (null = ยังไม่เคยกำหนด) */
function parsePages(value: string | null): string[] | null {
  if (value === null || value === undefined) return null
  return value.split(',').map((s) => s.trim()).filter(Boolean)
}

/** จำนวนผู้ใช้ในระบบ — ใช้ตัดสินว่าต้องพาไปหน้าตั้งค่าครั้งแรกหรือยัง */
export async function countUsers() {
  const row = await q1<{ n: number }>('select count(*)::int as n from profiles')
  return row?.n ?? 0
}

/**
 * อ่านผู้ใช้ที่ล็อกอินอยู่จาก Supabase Auth แล้วต่อด้วยข้อมูลสิทธิ์จากตาราง profiles
 * ถ้ายังไม่มีแถวใน profiles (เช่นสร้างบัญชีจากหน้า Supabase โดยตรง) จะสร้างให้เป็นพนักงาน
 */
/**
 * ห่อด้วย cache() เพื่อให้หนึ่งรีเควสต์ถาม Supabase และฐานข้อมูลแค่ครั้งเดียว
 * เดิม layout เรียกหนึ่งครั้งและตัวหน้าเรียกอีกครั้ง = ทำงานซ้ำสองเท่าทุกครั้งที่เปิดหน้า
 */
export const getSession = cache(async function getSession(): Promise<SessionUser | null> {
  let user: { id: string; email?: string } | null = null
  try {
    const supabase = await supabaseServer()
    user = (await supabase.auth.getUser()).data.user
  } catch (err) {
    // ยังตั้งค่า Supabase/ฐานข้อมูลไม่ครบ — ให้ถือว่ายังไม่ล็อกอิน
    // เพื่อพาไปหน้า login ที่อธิบายวิธีตั้งค่า แทนที่จะขึ้นหน้าจอ error
    if (err instanceof SupabaseConfigError || err instanceof ConfigError) return null
    throw err
  }
  if (!user) return null

  type ProfileRow = {
    display_name: string
    role: string
    is_active: boolean
    allowed_pages: string | null
  }
  let profile: ProfileRow | null = null
  try {
    // แปลง text[] เป็นข้อความคั่นจุลภาคตั้งแต่ใน SQL จะได้ไม่ต้องพึ่งการแปลง array ของไดรเวอร์
    profile = await q1<ProfileRow>(
      `select display_name, role, is_active,
              case when allowed_pages is null then null
                   else array_to_string(allowed_pages, ',') end as allowed_pages
         from profiles where id = $1`,
      [user.id]
    )
  } catch (err) {
    if (err instanceof ConfigError) return null
    throw err
  }

  if (!profile) {
    const email = user.email ?? ''
    await q(
      `insert into profiles (id, email, display_name, role)
       values ($1, $2, $3, 'staff') on conflict (id) do nothing`,
      [user.id, email, email.split('@')[0] || 'ผู้ใช้ใหม่']
    )
    return {
      id: user.id,
      email,
      name: email.split('@')[0] || 'ผู้ใช้ใหม่',
      role: 'staff',
      pages: resolvePages('staff', null),
    }
  }

  if (!profile.is_active) return null

  const role: Role = profile.role === 'admin' ? 'admin' : 'staff'

  return {
    id: user.id,
    email: user.email ?? '',
    name: profile.display_name || (user.email ?? '').split('@')[0],
    role,
    pages: resolvePages(role, parsePages(profile.allowed_pages)),
  }
})

/** ใช้ในหน้าที่ต้องล็อกอิน — ถ้าไม่มี session จะเด้งไปหน้า login */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSession()
  if (!user) redirect('/login')
  return user
}

/**
 * ใช้ในทุกหน้าที่กำหนดสิทธิ์เมนูได้ — ซ่อนเมนูอย่างเดียวไม่พอ
 * เพราะพิมพ์ URL ตรง ๆ ก็เข้าได้ ต้องกันที่ฝั่งเซิร์ฟเวอร์ด้วย
 */
export async function requirePage(page: PageKey): Promise<SessionUser> {
  const user = await requireUser()
  if (!user.pages.includes(page)) redirect(landingHref(user.pages))
  return user
}

/** ใช้กับแอ็กชันที่เข้าถึงได้จากหลายเมนู เช่น ยกเลิกบิลทำได้ทั้งหน้าลงยอดขายและหน้าประวัติ */
export async function requireAnyPage(...pages: PageKey[]): Promise<SessionUser> {
  const user = await requireUser()
  if (!pages.some((p) => user.pages.includes(p))) redirect(landingHref(user.pages))
  return user
}

/** ใช้ในหน้า/แอ็กชันที่เฉพาะแอดมินเท่านั้น */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser()
  if (user.role !== 'admin') redirect('/')
  return user
}
