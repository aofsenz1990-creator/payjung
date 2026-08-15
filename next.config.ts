import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  experimental: {
    // ฟอร์มทุกหน้าใช้ Server Action ที่รับ FormData ขนาดเล็ก
    serverActions: { bodySizeLimit: '1mb' },
  },
}

export default nextConfig
