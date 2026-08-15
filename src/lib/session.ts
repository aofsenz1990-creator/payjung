// โมดูลนี้ต้องรันได้บน Edge runtime ด้วย (middleware ใช้) จึงใช้ได้แค่ jose ห้ามแตะฐานข้อมูล
import { SignJWT, jwtVerify } from 'jose'

export const SESSION_COOKIE = 'payjung_session'
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30 // 30 วัน

export type Role = 'admin' | 'staff'

export type SessionUser = {
  id: number
  username: string
  name: string
  role: Role
}

function secretKey() {
  const secret = process.env.AUTH_SECRET
  if (!secret || secret.length < 16) {
    throw new Error(
      'ยังไม่ได้ตั้งค่า AUTH_SECRET (ต้องยาวอย่างน้อย 16 ตัวอักษร) — ตั้งใน Vercel > Settings > Environment Variables'
    )
  }
  return new TextEncoder().encode(secret)
}

export async function signSession(user: SessionUser) {
  return new SignJWT({ ...user })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secretKey())
}

export async function verifySession(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secretKey())
    if (typeof payload.id !== 'number' || typeof payload.username !== 'string') return null
    return {
      id: payload.id,
      username: payload.username,
      name: String(payload.name ?? payload.username),
      role: payload.role === 'admin' ? 'admin' : 'staff',
    }
  } catch {
    return null
  }
}

export const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: MAX_AGE_SECONDS,
}
