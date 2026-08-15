import 'server-only'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import bcrypt from 'bcryptjs'
import { q, q1 } from './db'
import { SESSION_COOKIE, verifySession, type SessionUser } from './session'

export type { SessionUser, Role } from './session'

export function hashPassword(plain: string) {
  return bcrypt.hashSync(plain, 10)
}

export function checkPassword(plain: string, hash: string) {
  return bcrypt.compareSync(plain, hash)
}

/** จำนวนผู้ใช้ในระบบ — ใช้ตัดสินว่าต้องพาไปหน้าตั้งค่าครั้งแรกหรือยัง */
export async function countUsers() {
  const row = await q1<{ n: number }>('select count(*)::int as n from users')
  return row?.n ?? 0
}

export async function getSession(): Promise<SessionUser | null> {
  const jar = await cookies()
  return verifySession(jar.get(SESSION_COOKIE)?.value)
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

export async function findUserByUsername(username: string) {
  return q1<{
    id: number
    username: string
    password_hash: string
    display_name: string
    role: string
    is_active: boolean
  }>('select * from users where lower(username) = lower($1) limit 1', [username])
}

export async function createUser(input: {
  username: string
  password: string
  displayName: string
  role: 'admin' | 'staff'
}) {
  const rows = await q<{ id: number }>(
    `insert into users (username, password_hash, display_name, role)
     values ($1, $2, $3, $4) returning id`,
    [input.username.trim(), hashPassword(input.password), input.displayName.trim(), input.role]
  )
  return rows[0]
}
