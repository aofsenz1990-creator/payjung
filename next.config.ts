import type { NextConfig } from 'next'

const isDev = process.env.NODE_ENV === 'development'

/**
 * นโยบายว่าหน้าเว็บโหลดอะไรได้บ้าง (Content Security Policy)
 * ตัวนี้คือด่านสุดท้ายถ้ามีสคริปต์แปลกปลอมหลุดเข้ามาในหน้า — มันจะรันไม่ได้และส่งข้อมูลออกไม่ได้
 *
 * ที่ต้องอนุญาต 'unsafe-inline' เพราะ Next.js ฝังสคริปต์เล็ก ๆ ไว้ในหน้าเองตั้งแต่ตอน build
 * ('unsafe-eval' เปิดเฉพาะตอนพัฒนา เพราะตัวรีเฟรชอัตโนมัติต้องใช้)
 */
const csp = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline'${isDev ? ` 'unsafe-eval'` : ''}`,
  `style-src 'self' 'unsafe-inline'`,
  // รูปเกม/สลิป เก็บอยู่ที่ Supabase Storage ส่วนรูปที่เพิ่งเลือกจะแสดงเป็น data: ก่อนอัปโหลด
  `img-src 'self' data: blob: https:`,
  `font-src 'self' data:`,
  `connect-src 'self' https://*.supabase.co https://*.supabase.in`,
  // ห้ามเปิดหน้าเว็บนี้ในกรอบ iframe ของเว็บอื่น (กันหลอกให้กดปุ่มโดยไม่รู้ตัว)
  `frame-ancestors 'none'`,
  `frame-src 'none'`,
  `object-src 'none'`,
  `base-uri 'self'`,
  // ฟอร์มทั้งหมดต้องส่งกลับมาที่เว็บเราเท่านั้น
  `form-action 'self'`,
  `upgrade-insecure-requests`,
].join('; ')

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  // บังคับให้เบราว์เซอร์ใช้ https เสมอ แม้ผู้ใช้พิมพ์ http
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  // ห้ามเบราว์เซอร์เดาชนิดไฟล์เอง (กันไฟล์รูปที่แอบเป็นสคริปต์)
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  // ไม่ส่ง URL เต็ม ๆ ของหน้าเราไปให้เว็บอื่นตอนผู้ใช้กดลิงก์ออก
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // ปิดสิทธิ์อุปกรณ์ที่เว็บนี้ไม่ได้ใช้เลย
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
]

const nextConfig: NextConfig = {
  // ไม่บอกยี่ห้อ/เวอร์ชันเซิร์ฟเวอร์ให้คนสแกนหาช่องโหว่รู้
  poweredByHeader: false,
  experimental: {
    // เผื่อไว้สำหรับรูปสลิปโอนเงิน (ย่อขนาดฝั่งเบราว์เซอร์แล้วเหลือไม่กี่ร้อย KB)
    serverActions: { bodySizeLimit: '6mb' },
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

export default nextConfig
