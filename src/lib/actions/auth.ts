'use server'

import { redirect } from 'next/navigation'
import { q } from '@/lib/db'
import { countUsers } from '@/lib/auth'
import { supabaseAdmin, supabaseServer } from '@/lib/supabase'
import { SEED_GAMES } from '@/lib/schema'
import { str, friendlyError } from '@/lib/form'
import type { ActionState } from '@/components/ActionForm'

/** แปลงข้อความ error ของ Supabase Auth เป็นภาษาไทย */
function authError(message: string) {
  if (/Invalid login credentials/i.test(message)) return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'
  if (/Email not confirmed/i.test(message)) return 'อีเมลนี้ยังไม่ได้ยืนยัน ติดต่อผู้ดูแลระบบ'
  if (/already registered|already been registered/i.test(message)) return 'อีเมลนี้ถูกใช้ไปแล้ว'
  if (/Password should be at least/i.test(message)) return 'รหัสผ่านสั้นเกินไป ต้องยาวอย่างน้อย 8 ตัวอักษร'
  if (/rate limit|too many/i.test(message)) return 'ลองบ่อยเกินไป รอสักครู่แล้วลองใหม่'
  if (/Unable to validate email|invalid format/i.test(message)) return 'รูปแบบอีเมลไม่ถูกต้อง'
  return message
}

export async function loginAction(formData: FormData): Promise<ActionState> {
  const email = str(formData, 'email')
  const password = str(formData, 'password')
  const next = str(formData, 'next')

  if (!email || !password) return { error: 'กรุณากรอกอีเมลและรหัสผ่าน' }

  try {
    const supabase = await supabaseServer()
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error: authError(error.message) }

    const profile = await q<{ is_active: boolean }>(
      'select is_active from profiles where id = $1',
      [data.user.id]
    )
    if (profile[0] && !profile[0].is_active) {
      await supabase.auth.signOut()
      return { error: 'บัญชีนี้ถูกปิดการใช้งาน ติดต่อผู้ดูแลระบบ' }
    }
  } catch (err) {
    return { error: friendlyError(err, 'เข้าสู่ระบบไม่สำเร็จ') }
  }

  redirect(next && next.startsWith('/') ? next : '/')
}

export async function logoutAction() {
  const supabase = await supabaseServer()
  await supabase.auth.signOut()
  redirect('/login')
}

/** สร้างบัญชีผู้ดูแลคนแรก — ใช้ได้เฉพาะตอนที่ยังไม่มีผู้ใช้ในระบบเลย */
export async function setupAction(formData: FormData): Promise<ActionState> {
  const email = str(formData, 'email')
  const password = str(formData, 'password')
  const confirm = str(formData, 'confirm')
  const displayName = str(formData, 'display_name') || email.split('@')[0]

  if (!email.includes('@')) return { error: 'กรุณากรอกอีเมลให้ถูกต้อง' }
  if (password.length < 8) return { error: 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร' }
  if (password !== confirm) return { error: 'รหัสผ่านสองช่องไม่ตรงกัน' }

  try {
    if ((await countUsers()) > 0) {
      return { error: 'ระบบถูกตั้งค่าไปแล้ว กรุณาเข้าสู่ระบบตามปกติ' }
    }

    const admin = supabaseAdmin()
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // ใช้ในร้าน ไม่ต้องส่งเมลยืนยัน
    })
    if (error || !data.user) return { error: authError(error?.message ?? 'สร้างบัญชีไม่สำเร็จ') }

    await q(
      `insert into profiles (id, email, display_name, role)
       values ($1, $2, $3, 'admin')
       on conflict (id) do update set role = 'admin', display_name = excluded.display_name`,
      [data.user.id, email, displayName]
    )

    // ใส่รายชื่อเกมยอดนิยมไว้ให้ตั้งต้น จะลบทิ้งภายหลังก็ได้
    for (const [name, publisher] of SEED_GAMES) {
      await q('insert into games (name, publisher) values ($1, $2) on conflict do nothing', [
        name,
        publisher,
      ])
    }

    const supabase = await supabaseServer()
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) return { error: authError(signInError.message) }
  } catch (err) {
    return { error: friendlyError(err, 'ตั้งค่าไม่สำเร็จ') }
  }

  redirect('/')
}
