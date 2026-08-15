import Link from 'next/link'
import {
  facebookLink,
  getShopCustomer,
  getSiteSettings,
  lineLink,
  registrationOpen,
} from '@/lib/shop'
import { ContactBar } from '@/components/ContactBar'
import { shopLogoutAction } from '@/lib/actions/shop'
import { BrandLogo } from '@/components/Brand'
import { money } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const [settings, customer] = await Promise.all([getSiteSettings(), getShopCustomer()])

  return (
    <div className="relative flex min-h-screen flex-col">
      {/*
        พื้นหลังของหน้าเว็บลูกค้า — วางไฟล์ไว้ที่ public/shop-bg.jpg
        ถ้าไม่มีไฟล์ก็จะเห็นเป็นพื้นสีเข้มตามปกติ ไม่พัง
        ตรึงไว้กับหน้าจอเพื่อไม่ให้เลื่อนตามเนื้อหา และไม่ใช้ background-attachment: fixed
        เพราะบนมือถือจะกระตุก
      */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-20 bg-ink-950 bg-[url('/shop-bg.jpg')] bg-cover bg-center bg-no-repeat"
      />
      {/* ฝ้าทับให้ตัวหนังสืออ่านง่าย เข้มขึ้นเรื่อย ๆ ตอนเลื่อนลงไปหาเนื้อหาด้านล่าง */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 bg-linear-to-b from-ink-950/55 via-ink-950/75 to-ink-950/92"
      />
      {settings.announcement ? (
        <div className="bg-linear-to-r from-brand-600 to-grape-600 px-4 py-2 text-center text-sm font-medium text-white">
          {settings.announcement}
        </div>
      ) : null}

      <header className="sticky top-0 z-30 border-b border-ink-800/60 bg-ink-950/60 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link href="/shop">
            <BrandLogo className="w-32 sm:w-40" compactFallback />
          </Link>

          {customer ? (
            <div className="flex items-center gap-2">
              <Link
                href="/shop/me"
                className="rounded-lg border border-good/40 bg-good/10 px-3 py-1.5 text-sm"
              >
                <span className="text-mute">เครดิต </span>
                <span className="font-bold text-good">{money(customer.credit)}</span>
                <span className="text-xs text-mute"> บาท</span>
              </Link>
              <form action={shopLogoutAction}>
                <button type="submit" className="btn-ghost btn-sm">
                  ออก
                </button>
              </form>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link href="/shop/login" className="btn-ghost btn-sm">
                เข้าสู่ระบบ
              </Link>
              {registrationOpen(settings) ? (
                <Link href="/shop/register" className="btn-primary btn-sm">
                  สมัครสมาชิก
                </Link>
              ) : null}
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>

      <footer className="relative mt-10 border-t border-ink-800/60 bg-ink-900/70 backdrop-blur-md">
        <div className="mx-auto max-w-6xl px-4 py-8">
          <h2 className="text-base font-semibold text-white">ช่องทางติดต่อ</h2>
          <ContactBar
            line={settings.contact_line}
            lineUrl={lineLink(settings.contact_line)}
            lineQr={settings.contact_line_qr}
            facebook={settings.contact_facebook}
            facebookUrl={facebookLink(settings.contact_facebook)}
            phone={settings.contact_phone}
            note={settings.contact_note}
          />
          <p className="mt-6 text-xs text-mute">© Pay Jung · ระบบเติมเกมออนไลน์</p>
        </div>
      </footer>
    </div>
  )
}
