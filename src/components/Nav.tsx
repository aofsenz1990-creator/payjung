'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { BrandLogo } from '@/components/Brand'
import type { Role } from '@/lib/auth'

type Item = { href: string; label: string; icon: string; adminOnly?: boolean }

const ITEMS: Item[] = [
  { href: '/', label: 'แดชบอร์ดสรุปยอด', icon: '📊' },
  { href: '/sales', label: 'ลงยอดขาย', icon: '🧾' },
  { href: '/history', label: 'ประวัติการเติม', icon: '🕘' },
  { href: '/games', label: 'รายชื่อเกม & แพ็กเกจ', icon: '🎮' },
  { href: '/stock', label: 'ระบบสต๊อก', icon: '📦' },
  { href: '/customers', label: 'รายชื่อลูกค้า', icon: '👥' },
  { href: '/expenses', label: 'ค่าใช้จ่ายรายเดือน', icon: '💸', adminOnly: true },
  { href: '/users', label: 'ผู้ใช้งานระบบ', icon: '🔐', adminOnly: true },
]

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function Nav({ role, user }: { role: Role; user: string }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const items = ITEMS.filter((i) => !i.adminOnly || role === 'admin')

  const list = (
    <nav className="space-y-1">
      {items.map((item) => {
        const active = isActive(pathname, item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
              active
                ? 'bg-brand-600/20 font-medium text-white ring-1 ring-brand-500/40'
                : 'text-slate-300 hover:bg-ink-850 hover:text-white'
            }`}
          >
            <span aria-hidden className="text-base">
              {item.icon}
            </span>
            <span className="truncate">{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )

  return (
    <>
      {/* แถบบนสำหรับจอมือถือ */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-ink-800 bg-ink-950/95 px-4 py-3 backdrop-blur lg:hidden">
        <Brand />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="btn-ghost btn-sm"
          aria-expanded={open}
        >
          {open ? 'ปิดเมนู' : 'เมนู'}
        </button>
      </div>
      {open ? (
        <div className="border-b border-ink-800 bg-ink-900 px-4 py-3 lg:hidden">{list}</div>
      ) : null}

      {/* เมนูด้านข้างสำหรับจอใหญ่ */}
      <aside className="hidden w-64 shrink-0 border-r border-ink-800 bg-ink-900 lg:flex lg:flex-col">
        <div className="px-5 py-6">
          <Brand />
        </div>
        <div className="flex-1 px-3">{list}</div>
        <div className="border-t border-ink-800 px-5 py-4">
          <p className="text-xs text-mute">เข้าใช้งานโดย</p>
          <p className="truncate text-sm font-medium text-white">{user}</p>
          <p className="mt-0.5 text-xs text-mute">
            {role === 'admin' ? 'ผู้ดูแลระบบ (เห็นทุนและกำไร)' : 'พนักงาน'}
          </p>
        </div>
      </aside>
    </>
  )
}

function Brand() {
  return (
    <Link href="/" className="flex items-center">
      <BrandLogo className="w-36 lg:w-44" compactFallback />
    </Link>
  )
}
