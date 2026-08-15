import Link from 'next/link'
import { redirect } from 'next/navigation'
import { countUsers, getSession } from '@/lib/auth'
import { getShopCustomer } from '@/lib/shop'
import { loginAction } from '@/lib/actions/auth'
import { publicSupabaseConfig } from '@/lib/supabase'
import { ActionForm, SubmitButton } from '@/components/ActionForm'
import { AuthShell, SetupHint } from '@/components/AuthShell'

export const dynamic = 'force-dynamic'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams

  let configError: string | null = null
  let shopCustomer: Awaited<ReturnType<typeof getShopCustomer>> = null
  try {
    publicSupabaseConfig() // เช็ก key ของ Supabase ก่อน แล้วค่อยแตะฐานข้อมูล
    if ((await countUsers()) === 0) redirect('/setup')
    // เป็นพนักงานจริงถึงจะพาเข้าหลังร้าน — ถ้าเป็นลูกค้าให้อยู่หน้านี้ต่อ
    if (await getSession()) redirect('/')
    shopCustomer = await getShopCustomer()
  } catch (err) {
    if (err && typeof err === 'object' && 'digest' in err) throw err // ปล่อย redirect ผ่าน
    configError = err instanceof Error ? err.message : String(err)
  }

  return (
    <AuthShell title="เข้าสู่ระบบ" subtitle="ระบบจัดการร้านเติมเกม Pay Jung">
      {configError ? <SetupHint message={configError} /> : null}

      {shopCustomer ? (
        <div className="mb-4 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2.5 text-sm text-warn">
          <p className="font-medium">คุณกำลังเข้าสู่ระบบเป็นลูกค้าอยู่</p>
          <p className="mt-1 text-xs leading-relaxed">
            บัญชี {shopCustomer.email} เป็นบัญชีลูกค้า เข้าหน้าหลังร้านไม่ได้
          </p>
          <Link href="/shop/me" className="btn-ghost btn-sm mt-2">
            ไปหน้าบัญชีลูกค้า →
          </Link>
        </div>
      ) : null}
      <ActionForm action={loginAction} className="space-y-4">
        <input type="hidden" name="next" value={next ?? ''} />
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
            autoFocus
            required
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
      <p className="mt-4 text-center text-xs text-mute">
        ลืมรหัสผ่าน? ให้ผู้ดูแลระบบตั้งรหัสใหม่ให้ที่หน้า “ผู้ใช้งานระบบ”
      </p>
    </AuthShell>
  )
}
