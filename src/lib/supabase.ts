import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export class SupabaseConfigError extends Error {}

/** URL และ key ฝั่งเบราว์เซอร์ — รองรับทั้งชื่อเดิม (anon) และชื่อใหม่ (publishable) ของ Supabase */
export function publicSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) {
    throw new SupabaseConfigError(
      'ยังไม่ได้ตั้งค่า NEXT_PUBLIC_SUPABASE_URL และ NEXT_PUBLIC_SUPABASE_ANON_KEY — คัดลอกจาก Supabase > Project Settings > API มาใส่ใน Environment Variables ของ Vercel'
    )
  }
  return { url, key }
}

/** client ที่ผูกกับ cookie ของรีเควสต์ ใช้ในหน้าเว็บและ Server Action */
export async function supabaseServer() {
  const { url, key } = publicSupabaseConfig()
  const jar = await cookies()
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return jar.getAll()
      },
      setAll(list) {
        try {
          for (const { name, value, options } of list) jar.set(name, value, options)
        } catch {
          // เรียกจาก Server Component ที่เขียน cookie ไม่ได้ — middleware จะรีเฟรช token ให้เอง
        }
      },
    },
  })
}

/**
 * client สิทธิ์ service role — ใช้เฉพาะฝั่งเซิร์ฟเวอร์สำหรับจัดการบัญชีผู้ใช้
 * (สร้างผู้ใช้ใหม่ / ตั้งรหัสผ่านใหม่ / ลบบัญชี) ห้ามส่ง key นี้ออกไปฝั่งเบราว์เซอร์เด็ดขาด
 */
export function supabaseAdmin() {
  const { url } = publicSupabaseConfig()
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
  if (!secret) {
    throw new SupabaseConfigError(
      'ยังไม่ได้ตั้งค่า SUPABASE_SERVICE_ROLE_KEY — คัดลอก service_role key จาก Supabase > Project Settings > API มาใส่ใน Environment Variables ของ Vercel (ตั้งเป็นความลับ ห้ามขึ้นต้นด้วย NEXT_PUBLIC_)'
    )
  }
  return createSupabaseClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
