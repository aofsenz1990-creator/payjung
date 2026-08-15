import 'server-only'
import { redirect } from 'next/navigation'
import { ConfigError, q, q1 } from './db'
import { supabaseServer, SupabaseConfigError } from './supabase'

export type Role = 'admin' | 'staff'

export type SessionUser = {
  id: string // uuid เดียวกับ auth.users.id ของ Supabase
  email: string
  name: string
  role: Role
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
export async function getSession(): Promise<SessionUser | null> {
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

  let profile: { display_name: string; role: string; is_active: boolean } | null = null
  try {
    profile = await q1<{ display_name: string; role: string; is_active: boolean }>(
      'select display_name, role, is_active from profiles where id = $1',
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
    return { id: user.id, email, name: email.split('@')[0] || 'ผู้ใช้ใหม่', role: 'staff' }
  }

  if (!profile.is_active) return null

  return {
    id: user.id,
    email: user.email ?? '',
    name: profile.display_name || (user.email ?? '').split('@')[0],
    role: profile.role === 'admin' ? 'admin' : 'staff',
  }
}

/** ใช้ในหน้าที่ต้องล็อกอิน — ถ้าไม่มี session จะเด้งไปหน้า login */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSession()
  if (!user) redirect('/login')
  return user
}

/** ใช้ในหน้า/แอ็กชันที่เฉพาะแอดมินเท่านั้น */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser()
  if (user.role !== 'admin') redirect('/')
  return user
}
