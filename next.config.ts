import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  experimental: {
    // เผื่อไว้สำหรับรูปสลิปโอนเงิน (ย่อขนาดฝั่งเบราว์เซอร์แล้วเหลือไม่กี่ร้อย KB)
    serverActions: { bodySizeLimit: '6mb' },
  },
}

export default nextConfig
