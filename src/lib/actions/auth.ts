'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { q } from '@/lib/db'
import { checkPassword, countUsers, createUser, findUserByUsername } from '@/lib/auth'
import { COOKIE_OPTIONS, SESSION_COOKIE, signSession, type SessionUser } from '@/lib/session'
import { SEED_GAMES } from '@/lib/schema'
import { str, friendlyError } from '@/lib/form'
import type { ActionState } from '@/components/ActionForm'

async function startSession(user: SessionUser) {
  const token = await signSession(user)
  const jar = await cookies()
  jar.set(SESSION_COOKIE, token, COOKIE_OPTIONS)
}

export async function loginAction(formData: FormData): Promise<ActionState> {
  const username = str(formData, 'username')
  const password = str(formData, 'password')
  const next = str(formData, 'next')

  if (!username || !password) return { error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' }

  try {
    const row = await findUserByUsername(username)
    if (!row || !checkPassword(password, row.password_hash)) {
      return { error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' }
    }
    if (!row.is_active) return { error: 'บัญชีนี้ถูกปิดการใช้งาน ติดต่อผู้ดูแลระบบ' }

    await startSession({
      id: row.id,
      username: row.username,
      name: row.display_name,
      role: row.role === 'admin' ? 'admin' : 'staff',
    })
  } catch (err) {
    return { error: friendlyError(err, 'เข้าสู่ระบบไม่สำเร็จ') }
  }

  redirect(next && next.startsWith('/') ? next : '/')
}

export async function logoutAction() {
  const jar = await cookies()
  jar.delete(SESSION_COOKIE)
  redirect('/login')
}

/** สร้างบัญชีแอดมินคนแรก — ใช้ได้เฉพาะตอนที่ยังไม่มีผู้ใช้ในระบบเลย */
export async function setupAction(formData: FormData): Promise<ActionState> {
  const username = str(formData, 'username')
  const password = str(formData, 'password')
  const confirm = str(formData, 'confirm')
  const displayName = str(formData, 'display_name') || username

  if (username.length < 3) return { error: 'ชื่อผู้ใช้ต้องยาวอย่างน้อย 3 ตัวอักษร' }
  if (password.length < 8) return { error: 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร' }
  if (password !== confirm) return { error: 'รหัสผ่านสองช่องไม่ตรงกัน' }

  try {
    if ((await countUsers()) > 0) {
      return { error: 'ระบบถูกตั้งค่าไปแล้ว กรุณาเข้าสู่ระบบตามปกติ' }
    }

    const created = await createUser({ username, password, displayName, role: 'admin' })

    // ใส่รายชื่อเกมยอดนิยมไว้ให้ตั้งต้น จะลบทิ้งภายหลังก็ได้
    for (const [name, publisher] of SEED_GAMES) {
      await q('insert into games (name, publisher) values ($1, $2) on conflict do nothing', [
        name,
        publisher,
      ])
    }

    await startSession({ id: created.id, username, name: displayName, role: 'admin' })
  } catch (err) {
    return { error: friendlyError(err, 'ตั้งค่าไม่สำเร็จ') }
  }

  redirect('/')
}
