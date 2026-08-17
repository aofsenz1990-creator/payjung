import Link from 'next/link'
import { LineQrButton } from '@/components/LineQrButton'

/**
 * ปุ่มลอยมุมขวาของหน้าเว็บลูกค้า
 *
 * เอาไว้ให้ลูกค้ากดถึงสิ่งที่ต้องใช้บ่อยได้จากทุกหน้าโดยไม่ต้องเลื่อนหาเมนูข้างบน
 * แสดงเฉพาะปุ่มที่ตั้งค่าไว้แล้วเท่านั้น — ปุ่มที่กดแล้วไม่มีอะไรเกิดขึ้นแย่กว่าไม่มีปุ่ม
 */
export function FloatingActions({
  lineUrl,
  lineId,
  lineQr,
  facebookUrl,
  signedIn,
  unread,
}: {
  lineUrl: string | null
  lineId: string | null
  /** รูป QR ที่อัปโหลดไว้ในหน้าตั้งค่า — มีแล้วจะกดเด้ง QR แทนการลิงก์ออกไปเลย */
  lineQr: string | null
  facebookUrl: string | null
  signedIn: boolean
  unread: number
}) {
  return (
    <div className="fixed right-3 bottom-20 z-40 flex flex-col items-end gap-3 sm:right-5 sm:bottom-24">
      {/* เติมเครดิต — ปุ่มที่ทำเงินให้ร้านมากที่สุด จึงอยู่บนสุดและใช้สีแบรนด์ */}
      <FloatingButton
        href={signedIn ? '/shop/topup' : '/shop/login'}
        label="เติมเครดิต"
        className="bg-linear-to-br from-sun to-warn text-[#221803]"
      >
        <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="20" r="1.4" />
          <circle cx="18" cy="20" r="1.4" />
          <path d="M2 3h2.2l2.3 11.2a2 2 0 0 0 2 1.6h8.4a2 2 0 0 0 2-1.6L21 7H5.4" />
        </svg>
      </FloatingButton>

      {/* กล่องข้อความ — โค้ดบัตรและข้อความจากร้านอยู่ในนี้ ต้องกดถึงได้ตลอด */}
      {signedIn ? (
        <FloatingButton
          href="/shop/me#messages"
          label={unread > 0 ? `ข้อความใหม่ ${unread}` : 'กล่องข้อความ'}
          className="bg-linear-to-br from-brand-500 to-grape-500 text-white"
          badge={unread}
        >
          <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 9 9 0 0 1-3.6-.7L3 21l1.7-5.1A8.4 8.4 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3 8.5 8.5 0 0 1 21 11.5z" />
          </svg>
        </FloatingButton>
      ) : null}

      {/* มี QR = กดแล้วเด้งรูปให้สแกน (ใช้ได้ทั้งคนเปิดบนคอมและบนมือถือ)
          ไม่มี QR = ลิงก์ออกไปที่ LINE ตรง ๆ เหมือนเดิม */}
      {lineQr ? (
        <LineQrButton qrUrl={lineQr} lineUrl={lineUrl} lineId={lineId} />
      ) : lineUrl ? (
        <FloatingButton href={lineUrl} label="แชทกับร้านทาง LINE" external className="bg-[#06C755] text-white">
          <span className="text-[11px] font-extrabold tracking-tight">LINE</span>
        </FloatingButton>
      ) : null}

      {facebookUrl ? (
        <FloatingButton href={facebookUrl} label="เพจ Facebook ของร้าน" external className="bg-[#1877F2] text-white">
          <svg viewBox="0 0 24 24" className="size-6" fill="currentColor">
            <path d="M13.5 21v-8h2.7l.4-3.1h-3.1V7.9c0-.9.25-1.5 1.55-1.5H16.7V3.6c-.29-.04-1.3-.13-2.47-.13-2.44 0-4.11 1.49-4.11 4.23v2.19H7.4V13h2.72v8h3.38z" />
          </svg>
        </FloatingButton>
      ) : null}
    </div>
  )
}

function FloatingButton({
  href,
  label,
  className,
  external,
  badge,
  children,
}: {
  href: string
  label: string
  className: string
  external?: boolean
  badge?: number
  children: React.ReactNode
}) {
  // ป้ายชื่อจะคลี่ออกตอนชี้เมาส์บนจอใหญ่ ส่วนบนมือถือใช้ปุ่มกลม ๆ อย่างเดียวไม่ให้กินพื้นที่
  const inner = (
    <>
      <span className="pointer-events-none absolute right-full mr-2 hidden whitespace-nowrap rounded-lg bg-ink-950/90 px-2.5 py-1 text-xs text-fg opacity-0 shadow-lg transition group-hover:opacity-100 sm:block">
        {label}
      </span>
      {children}
      {badge && badge > 0 ? (
        <span className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full bg-bad text-[10px] font-bold text-white ring-2 ring-ink-950">
          {badge > 9 ? '9+' : badge}
        </span>
      ) : null}
    </>
  )

  const cls = `group relative flex size-12 items-center justify-center rounded-full shadow-lg shadow-black/40 transition hover:scale-110 active:scale-95 ${className}`

  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cls} aria-label={label} title={label}>
        {inner}
      </a>
    )
  }
  return (
    <Link href={href} className={cls} aria-label={label} title={label}>
      {inner}
    </Link>
  )
}
