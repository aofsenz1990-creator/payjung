import type { Metadata, Viewport } from 'next'
import { Noto_Sans_Thai } from 'next/font/google'
import './globals.css'

const thai = Noto_Sans_Thai({
  subsets: ['thai', 'latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Pay Jung — ระบบจัดการร้านเติมเกม',
  description: 'ระบบสต๊อก ยอดขาย ลูกค้า และสรุปกำไรสำหรับร้านเติมเกม Pay Jung',
}

export const viewport: Viewport = {
  themeColor: '#080b16',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={thai.className}>
      <body className="min-h-screen bg-ink-950 text-slate-100">{children}</body>
    </html>
  )
}
