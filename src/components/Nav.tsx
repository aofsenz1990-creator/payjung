'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { BrandLogo, BrandWordmark } from '@/components/Brand'
import { PAGES, type PageKey } from '@/lib/pages'

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function Nav({
  pages,
  user,
  roleLabel,
}: {
  pages: PageKey[]
  user: string
  roleLabel: string
}) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const items = PAGES.filter((p) => pages.includes(p.key))

  const list = (
    <nav className="space-y-1">
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-ink-700 px-3 py-4 text-center text-xs leading-relaxed text-mute">
          ยังไม่ได้รับสิทธิ์เข้าถึงเมนูใด ๆ<br />
          ติดต่อผู้ดูแลระบบ
        </p>
      ) : null}
      {items.map((item) => {
        const active = isActive(pathname, item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            // ปิด prefetch เพราะทุกหน้าดึงข้อมูลสด แค่เลื่อนเมาส์ผ่านเมนูก็ยิงถาม Supabase
            // ทุกปุ่มโดยที่ยังไม่ได้กดเข้าไปดูเลย กินโควตา egress ฟรี ๆ
            prefetch={false}
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
          <p className="mt-0.5 text-xs text-mute">{roleLabel}</p>
        </div>
      </aside>
    </>
  )
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <BrandLogo circle size={56} compactFallback />
      <BrandWordmark />
    </Link>
  )
}
