'use server'

import { revalidatePath } from 'next/cache'
import { q, q1 } from '@/lib/db'
import { createUser, hashPassword, requireAdmin } from '@/lib/auth'
import { friendlyError, int, str } from '@/lib/form'
import type { ActionState } from '@/components/ActionForm'

export async function createUserAction(formData: FormData): Promise<ActionState> {
  await requireAdmin()
  const username = str(formData, 'username')
  const displayName = str(formData, 'display_name') || username
  const password = str(formData, 'password')
  const role = str(formData, 'role') === 'admin' ? 'admin' : 'staff'

  if (username.length < 3) return { error: 'ชื่อผู้ใช้ต้องยาวอย่างน้อย 3 ตัวอักษร' }
  if (password.length < 8) return { error: 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร' }

  try {
    await createUser({ username, password, displayName, role })
  } catch (err) {
    return { error: friendlyError(err) }
  }

  revalidatePath('/users')
  return { ok: `เพิ่มผู้ใช้ "${displayName}" แล้ว` }
}

export async function resetPasswordAction(formData: FormData): Promise<ActionState> {
  await requireAdmin()
  const id = int(formData, 'id')
  const password = str(formData, 'password')
  if (password.length < 8) return { error: 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร' }

  try {
    await q('update users set password_hash = $2 where id = $1', [id, hashPassword(password)])
  } catch (err) {
    return { error: friendlyError(err) }
  }

  revalidatePath('/users')
  return { ok: 'เปลี่ยนรหัสผ่านเรียบร้อย' }
}

export async function toggleUserAction(formData: FormData) {
  const admin = await requireAdmin()
  const id = int(formData, 'id')
  if (id === admin.id) return // กันไม่ให้ปิดบัญชีตัวเอง

  // ต้องเหลือแอดมินที่ใช้งานได้อย่างน้อย 1 คนเสมอ
  const target = await q1<{ role: string; is_active: boolean }>(
    'select role, is_active from users where id = $1',
    [id]
  )
  if (target?.role === 'admin' && target.is_active) {
    const row = await q1<{ n: number }>(
      "select count(*)::int as n from users where role = 'admin' and is_active"
    )
    if ((row?.n ?? 0) <= 1) return
  }

  await q('update users set is_active = not is_active where id = $1', [id])
  revalidatePath('/users')
}

export async function changeRoleAction(formData: FormData) {
  const admin = await requireAdmin()
  const id = int(formData, 'id')
  const role = str(formData, 'role') === 'admin' ? 'admin' : 'staff'
  if (id === admin.id) return // กันไม่ให้ลดสิทธิ์ตัวเอง จนไม่เหลือแอดมิน

  await q('update users set role = $2 where id = $1', [id, role])
  revalidatePath('/users')
}

export async function deleteUserAction(formData: FormData) {
  const admin = await requireAdmin()
  const id = int(formData, 'id')
  if (id === admin.id) return
  await q('delete from users where id = $1', [id])
  revalidatePath('/users')
}
