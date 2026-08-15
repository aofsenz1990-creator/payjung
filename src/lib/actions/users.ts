'use server'

import { revalidatePath } from 'next/cache'
import { q, q1 } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { friendlyError, str } from '@/lib/form'
import type { ActionState } from '@/components/ActionForm'

function authError(message: string) {
  if (/already registered|already been registered/i.test(message)) return 'อีเมลนี้ถูกใช้ไปแล้ว'
  if (/Password should be at least/i.test(message)) return 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร'
  if (/Unable to validate email|invalid format/i.test(message)) return 'รูปแบบอีเมลไม่ถูกต้อง'
  return message
}

export async function createUserAction(formData: FormData): Promise<ActionState> {
  await requireAdmin()
  const email = str(formData, 'email')
  const displayName = str(formData, 'display_name') || email.split('@')[0]
  const password = str(formData, 'password')
  const role = str(formData, 'role') === 'admin' ? 'admin' : 'staff'

  if (!email.includes('@')) return { error: 'กรุณากรอกอีเมลให้ถูกต้อง' }
  if (password.length < 8) return { error: 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร' }

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (error || !data.user) return { error: authError(error?.message ?? 'สร้างบัญชีไม่สำเร็จ') }

    await q(
      `insert into profiles (id, email, display_name, role)
       values ($1, $2, $3, $4)
       on conflict (id) do update set email = excluded.email,
                                      display_name = excluded.display_name,
                                      role = excluded.role`,
      [data.user.id, email, displayName, role]
    )
  } catch (err) {
    return { error: friendlyError(err) }
  }

  revalidatePath('/users')
  return { ok: `เพิ่มผู้ใช้ "${displayName}" แล้ว` }
}

export async function resetPasswordAction(formData: FormData): Promise<ActionState> {
  await requireAdmin()
  const id = str(formData, 'id')
  const password = str(formData, 'password')

  if (!id) return { error: 'กรุณาเลือกผู้ใช้' }
  if (password.length < 8) return { error: 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร' }

  try {
    const admin = supabaseAdmin()
    const { error } = await admin.auth.admin.updateUserById(id, { password })
    if (error) return { error: authError(error.message) }
  } catch (err) {
    return { error: friendlyError(err) }
  }

  revalidatePath('/users')
  return { ok: 'เปลี่ยนรหัสผ่านเรียบร้อย' }
}

export async function toggleUserAction(formData: FormData) {
  const admin = await requireAdmin()
  const id = str(formData, 'id')
  if (!id || id === admin.id) return // กันไม่ให้ปิดบัญชีตัวเอง

  // ต้องเหลือแอดมินที่ใช้งานได้อย่างน้อย 1 คนเสมอ
  const target = await q1<{ role: string; is_active: boolean }>(
    'select role, is_active from profiles where id = $1',
    [id]
  )
  if (target?.role === 'admin' && target.is_active) {
    const row = await q1<{ n: number }>(
      "select count(*)::int as n from profiles where role = 'admin' and is_active"
    )
    if ((row?.n ?? 0) <= 1) return
  }

  await q('update profiles set is_active = not is_active where id = $1', [id])
  revalidatePath('/users')
}

export async function changeRoleAction(formData: FormData) {
  const admin = await requireAdmin()
  const id = str(formData, 'id')
  const role = str(formData, 'role') === 'admin' ? 'admin' : 'staff'
  if (!id || id === admin.id) return // กันไม่ให้ลดสิทธิ์ตัวเอง จนไม่เหลือแอดมิน

  await q('update profiles set role = $2 where id = $1', [id, role])
  revalidatePath('/users')
}

export async function deleteUserAction(formData: FormData) {
  const admin = await requireAdmin()
  const id = str(formData, 'id')
  if (!id || id === admin.id) return

  const client = supabaseAdmin()
  await client.auth.admin.deleteUser(id)
  await q('delete from profiles where id = $1', [id])
  revalidatePath('/users')
}
