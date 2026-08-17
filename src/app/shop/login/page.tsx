import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getShopCustomer, getSiteSettings, registrationOpen } from '@/lib/shop'
import { shopLoginAction } from '@/lib/actions/shop'
import { ActionForm, SubmitButton } from '@/components/ActionForm'

export const dynamic = 'force-dynamic'

export default async function ShopLoginPage() {
  if (await getShopCustomer()) redirect('/shop/me')
  const canRegister = registrationOpen(await getSiteSettings())

  return (
    <div className="mx-auto max-w-sm py-6">
      <h1 className="text-center text-xl font-bold text-white">เข้าสู่ระบบลูกค้า</h1>
      <p className="mt-1 text-center text-sm text-mute">
        {canRegister ? 'ยังไม่มีบัญชี? สมัครฟรีได้เลย' : 'ใช้อีเมลและรหัสผ่านที่ทางร้านสร้างให้'}
      </p>

      <div className="card mt-6 border-ink-700/70 bg-ink-900/75 backdrop-blur-md">
        <ActionForm action={shopLoginAction} className="space-y-4">
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
              required
              autoFocus
            />
          </div>
          <div>
            <label className="label" htmlFor="password">
              รหัสผ่าน
            </label>
            <input
              id="password"
              name="password"
              type="password"
              className="input"
              autoComplete="current-password"
              required
            />
          </div>
          <SubmitButton className="btn-primary w-full" pendingLabel="กำลังเข้าสู่ระบบ...">
            เข้าสู่ระบบ
          </SubmitButton>
        </ActionForm>

        <p className="mt-3 text-center text-sm">
          <Link href="/shop/forgot" className="text-brand-400 underline">
            ลืมรหัสผ่าน?
          </Link>
        </p>

        {canRegister ? (
          <Link href="/shop/register" className="btn-ghost mt-4 w-full">
            สมัครบัญชีใหม่
          </Link>
        ) : null}

        <p className="mt-4 text-center text-xs leading-relaxed text-mute">
          {canRegister ? null : (
            <>
              ยังไม่มีบัญชี? ติดต่อทางร้านเพื่อเปิดบัญชีและเติมเครดิต
              <br />
            </>
          )}
          <Link href="/shop" className="text-brand-400 underline">
            กลับหน้าแรก
          </Link>
        </p>
      </div>
    </div>
  )
}
