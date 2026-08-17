import Link from 'next/link'
import {
  facebookLink,
  getShopCustomer,
  getSiteSettings,
  lineLink,
  registrationOpen,
  shopBackground,
  shopCover,
  shopOverlayClass,
} from '@/lib/shop'
import { ContactBar } from '@/components/ContactBar'
import { shopLogoutAction } from '@/lib/actions/shop'
import { BrandLogo, BrandWordmark } from '@/components/Brand'
import { money, num } from '@/lib/format'
import { q1 } from '@/lib/db'

export const dynamic = 'force-dynamic'

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const [settings, customer] = await Promise.all([getSiteSettings(), getShopCustomer()])

  // จำนวนข้อความที่ยังไม่ได้อ่าน — ต้องเด่นตั้งแต่แถบบน เพราะโค้ดบัตรเติมเกมส่งมาทางนี้
  // ถ้าลูกค้าไม่รู้ว่ามีข้อความ ก็เท่ากับซื้อของแล้วไม่ได้ของ
  let unread = 0
  if (customer) {
    try {
      const row = await q1<{ n: number }>(
        'select count(*)::int as n from customer_messages where customer_id = $1 and read_at is null',
        [customer.id]
      )
      unread = row?.n ?? 0
    } catch {
      // ตารางยังไม่ถูกสร้าง หรือฐานข้อมูลมีปัญหาชั่วคราว — ไม่ต้องโชว์ตัวเลข ดีกว่าทำหน้าเว็บพัง
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col">
      {/*
        พื้นหลังของหน้าเว็บลูกค้า
        ห้ามใช้ z-index ติดลบ เพราะเบราว์เซอร์จะวาดพื้นหลังทึบของ body ทับลงไปอีกที
        ทำให้ภาพหายไปทั้งที่ค่า CSS ถูกต้องทุกอย่าง — ใช้ z-0 แล้วดันเนื้อหาขึ้น z-10 แทน

        จอแคบใช้ความกว้างเต็มแล้วชิดบน เพื่อให้เห็นลายที่อยู่ริมภาพครบ
        (ถ้าใช้ cover บนจอแคบ ภาพแนวนอนจะถูกครอบจนเหลือแต่ตรงกลางที่ว่างเปล่า)
        จอกว้างค่อยใช้ cover ให้เต็มพื้นที่
      */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 bg-ink-950 bg-[length:100%_auto] bg-top bg-no-repeat md:bg-cover md:bg-center"
        style={{ backgroundImage: `url(${shopBackground(settings)})` }}
      />
      {/* ฝ้าทับให้ตัวหนังสืออ่านง่าย ปรับความเข้มได้จากหลังร้าน */}
      <div
        aria-hidden
        className={`pointer-events-none fixed inset-0 z-0 bg-linear-to-b ${shopOverlayClass(settings)}`}
      />
      {settings.announcement ? (
        <div className="relative z-10 bg-linear-to-r from-brand-600 to-grape-600 px-4 py-2 text-center text-sm font-medium text-white">
          {settings.announcement}
        </div>
      ) : null}

      <header className="sticky top-0 z-30 border-b border-ink-800/60 bg-ink-950/80 backdrop-blur-md">
        {/*
          ภาพพื้นหลังของแถบเมนู อัปโหลดเปลี่ยนได้จากหลังร้าน
          ถ้าโหลดรูปไม่ขึ้น ชั้นนี้จะโปร่งใส แล้วสีพื้นของ header จะโผล่มาแทนเอง
        */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: `url(${shopCover(settings)})` }}
        />
        {/* ฝ้าเข้มที่ริมสองข้าง เพราะโลโก้กับปุ่มอยู่ตรงนั้น ตรงกลางปล่อยให้เห็นภาพชัด */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-linear-to-r from-ink-950/85 via-ink-950/45 to-ink-950/85"
        />
        <div className="relative mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link href="/shop" className="flex items-center gap-2.5">
            <BrandLogo circle size={56} compactFallback />
            <BrandWordmark subtitle="บริการเติมเกมออนไลน์" />
          </Link>

          {customer ? (
            <div className="flex items-center gap-2">
              {unread > 0 ? (
                <Link
                  href="/shop/me#messages"
                  className="rounded-lg border border-brand-500/60 bg-brand-500/15 px-3 py-1.5 text-sm font-medium text-brand-400"
                >
                  ✉ {num(unread)} ข้อความใหม่
                </Link>
              ) : null}
              <Link
                href="/shop/me"
                className="rounded-lg border border-good/40 bg-good/10 px-3 py-1.5 text-sm"
              >
                <span className="text-mute">เครดิต </span>
                <span className="font-bold text-good">{money(customer.credit)}</span>
                <span className="text-xs text-mute"> บาท</span>
              </Link>
              <Link href="/shop/topup" className="btn-primary btn-sm">
                + เติมเครดิต
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

      <main className="relative z-10 mx-auto w-full max-w-[1440px] flex-1 px-4 py-6">{children}</main>

      <footer className="relative z-10 mt-10 border-t border-ink-800/60 bg-ink-900/70 backdrop-blur-md">
        <div className="mx-auto max-w-[1440px] px-4 py-8">
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
