import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getShopCustomer, getSiteSettings, registrationOpen } from '@/lib/shop'
import { shopRegisterAction } from '@/lib/actions/shop'
import { ActionForm, SubmitButton } from '@/components/ActionForm'

export const dynamic = 'force-dynamic'

export default async function ShopRegisterPage() {
  if (await getShopCustomer()) redirect('/shop/me')

  const settings = await getSiteSettings()
  if (!registrationOpen(settings)) {
    return (
      <div className="mx-auto max-w-sm py-10 text-center">
        <p className="text-4xl">🔒</p>
        <h1 className="mt-3 text-xl font-bold text-white">ตอนนี้ปิดรับสมัครเอง</h1>
        <p className="mt-2 text-sm leading-relaxed text-mute">
          กรุณาติดต่อทางร้านเพื่อเปิดบัญชีให้ (ดูช่องทางติดต่อด้านล่างหน้าเว็บ)
        </p>
        <Link href="/shop" className="btn-ghost mt-5 inline-flex">
          กลับหน้าแรก
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md py-6">
      <h1 className="text-center text-xl font-bold text-white">สมัครบัญชีลูกค้า</h1>
      <p className="mt-1 text-center text-sm text-mute">
        กรอกแค่อีเมลกับรหัสผ่าน แล้วเติมเครดิตกับทางร้านเพื่อเริ่มสั่งซื้อ
      </p>

      <div className="card mt-6 border-ink-700/70 bg-ink-900/75 backdrop-blur-md">
        <ActionForm action={shopRegisterAction} className="space-y-4">
          <div>
            <label className="label" htmlFor="email">
              อีเมล
            </label>
            <input
              id="email"
              name="email"
              type="email"
              className="input"
              autoComplete="username"
              placeholder="you@example.com"
              required
              autoFocus
            />
          </div>

          <div>
            <label className="label" htmlFor="password">
              รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)
            </label>
            <input
              id="password"
              name="password"
              type="password"
              className="input"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>

          <div>
            <label className="label" htmlFor="confirm">
              ยืนยันรหัสผ่าน
            </label>
            <input
              id="confirm"
              name="confirm"
              type="password"
              className="input"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>

          <SubmitButton className="btn-primary w-full" pendingLabel="กำลังสมัคร...">
            สมัครสมาชิก
          </SubmitButton>
        </ActionForm>

        <p className="mt-4 text-center text-xs text-mute">
          มีบัญชีแล้ว?{' '}
          <Link href="/shop/login" className="text-brand-400 underline">
            เข้าสู่ระบบ
          </Link>
        </p>
      </div>
    </div>
  )
}
