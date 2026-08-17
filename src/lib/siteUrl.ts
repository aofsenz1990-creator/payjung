import 'server-only'
import { headers } from 'next/headers'

/**
 * ที่อยู่เว็บของเราแบบเต็ม (https://...) สำหรับส่งให้ระบบภายนอกยิงกลับมา
 *
 * ลองจาก header ของรีเควสต์ก่อน เพราะเป็นค่าที่ตรงกับโดเมนที่ใช้จริงเสมอ
 * ย้ายโดเมนเมื่อไหร่ก็ตามทันทีโดยไม่ต้องแก้โค้ดหรือตั้งค่าใหม่
 * ถ้าอ่านไม่ได้ (ถูกเรียกนอกรีเควสต์) ค่อยตกไปใช้ค่าที่ Vercel ใส่ให้
 */
export async function publicOrigin(): Promise<string | null> {
  try {
    const h = await headers()
    const host = h.get('x-forwarded-host') ?? h.get('host')
    if (host) {
      const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
      return `${proto}://${host}`
    }
  } catch {
    // ไม่ได้อยู่ในรีเควสต์ — ใช้ค่าจาก environment แทน
  }

  const fromEnv =
    process.env.PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL
  if (!fromEnv) return null
  return fromEnv.startsWith('http') ? fromEnv : `https://${fromEnv}`
}

/**
 * ลิงก์ที่ผู้ให้บริการใช้ยิงผลออเดอร์กลับมา
 * คืน null ถ้ายังไม่ได้ตั้งกุญแจลับ — จะได้ไม่ส่งลิงก์ที่ปลายทางยิงมาแล้วโดนปฏิเสธทุกครั้ง
 */
export async function providerCallbackUrl(): Promise<string | null> {
  const secret = process.env.PROVIDER_CALLBACK_SECRET
  if (!secret) return null
  const origin = await publicOrigin()
  if (!origin) return null
  return `${origin}/api/provider-callback/${encodeURIComponent(secret)}`
}
