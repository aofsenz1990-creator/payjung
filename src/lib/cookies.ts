/**
 * ตัวเลือกความปลอดภัยของ cookie ที่เก็บ session
 *
 * ทั้งเว็บคุยกับ Supabase จากฝั่งเซิร์ฟเวอร์อย่างเดียว ไม่มีสคริปต์ในเบราว์เซอร์ที่ต้องอ่าน cookie นี้
 * จึงตั้ง httpOnly ได้เต็มที่ — ถ้าวันหนึ่งมีสคริปต์แปลกปลอมหลุดเข้ามาในหน้า
 * มันจะอ่าน session ไปสวมรอยเป็นลูกค้าหรือแอดมินไม่ได้
 *
 * แยกไฟล์ไว้ต่างหากเพราะ middleware ก็ต้องใช้ และ middleware นำเข้าไฟล์ที่แตะ
 * next/headers (อย่าง lib/supabase.ts) ไม่ได้
 */
export function sessionCookieOptions<T extends Record<string, unknown>>(options: T) {
  return {
    ...options,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
  }
}
