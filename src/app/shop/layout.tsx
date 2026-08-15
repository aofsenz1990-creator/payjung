import Link from 'next/link'
import { getShopCustomer, getSiteSettings, registrationOpen } from '@/lib/shop'
import { shopLogoutAction } from '@/lib/actions/shop'
import { BrandLogo } from '@/components/Brand'
import { money } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const [settings, customer] = await Promise.all([getSiteSettings(), getShopCustomer()])

  const contacts = [
    { label: 'LINE', value: settings.contact_line, icon: '💬' },
    { label: 'Facebook', value: settings.contact_facebook, icon: '📘' },
    { label: 'โทร', value: settings.contact_phone, icon: '📞' },
  ].filter((c) => c.value)

  return (
    <div className="flex min-h-screen flex-col bg-ink-950">
      {settings.announcement ? (
        <div className="bg-linear-to-r from-brand-600 to-grape-600 px-4 py-2 text-center text-sm font-medium text-white">
          {settings.announcement}
        </div>
      ) : null}

      <header className="sticky top-0 z-30 border-b border-ink-800 bg-ink-950/95 backdrop-blur">
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

      <footer className="mt-10 border-t border-ink-800 bg-ink-900">
        <div className="mx-auto max-w-6xl px-4 py-8">
          <h2 className="text-base font-semibold text-white">ช่องทางติดต่อ</h2>
          {contacts.length === 0 ? (
            <p className="mt-2 text-sm text-mute">ยังไม่ได้ตั้งค่าช่องทางติดต่อ</p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-3">
              {contacts.map((c) => (
                <span
                  key={c.label}
                  className="rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 text-sm"
                >
                  <span aria-hidden className="mr-1.5">
                    {c.icon}
                  </span>
                  <span className="text-mute">{c.label} </span>
                  <span className="text-slate-100">{c.value}</span>
                </span>
              ))}
            </div>
          )}
          {settings.contact_note ? (
            <p className="mt-3 text-sm text-mute">{settings.contact_note}</p>
          ) : null}
          <p className="mt-6 text-xs text-mute">© Pay Jung · ระบบเติมเกมออนไลน์</p>
        </div>
      </footer>
    </div>
  )
}
