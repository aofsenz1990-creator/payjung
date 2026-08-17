import Link from 'next/link'
import { setNewPasswordAction } from '@/lib/actions/account'
import { supabaseServer } from '@/lib/supabase'
import { ActionForm, SubmitButton } from '@/components/ActionForm'

export const dynamic = 'force-dynamic'

export default async function ShopResetPage({
  searchParams,
}: {
  searchParams: Promise<{ problem?: string }>
}) {
  const { problem } = await searchParams

  // มาถึงหน้านี้ได้พร้อม session = กดลิงก์จากอีเมลสำเร็จแล้ว ถือว่ายืนยันตัวตนผ่าน
  let signedIn = false
  if (!problem) {
    try {
      const supabase = await supabaseServer()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      signedIn = Boolean(user)
    } catch {
      signedIn = false
    }
  }

  return (
    <div className="mx-auto max-w-sm py-6">
      <h1 className="text-center text-xl font-bold text-white">ตั้งรหัสผ่านใหม่</h1>

      <div className="card mt-6 border-ink-700/70 bg-ink-900/75 backdrop-blur-md">
        {signedIn ? (
          <>
            <p className="mb-4 text-center text-sm text-mute">
              ตั้งรหัสผ่านใหม่ที่จะใช้เข้าสู่ระบบครั้งต่อไป
            </p>
            <ActionForm action={setNewPasswordAction} className="space-y-4">
              <div>
                <label className="label" htmlFor="password">
                  รหัสผ่านใหม่
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  className="input"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  autoFocus
                />
                <p className="mt-1 text-xs text-mute">อย่างน้อย 8 ตัวอักษร มีทั้งตัวอักษรและตัวเลข</p>
              </div>
              <div>
                <label className="label" htmlFor="confirm">
                  ยืนยันรหัสผ่านใหม่
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
              <SubmitButton className="btn-primary w-full" pendingLabel="กำลังบันทึก...">
                บันทึกรหัสผ่านใหม่
              </SubmitButton>
            </ActionForm>
          </>
        ) : (
          <>
            <p className="text-center text-sm leading-relaxed text-mute">
              ลิงก์นี้หมดอายุ ถูกใช้ไปแล้ว หรือถูกเปิดในเบราว์เซอร์คนละตัวกับที่กดขอ
              <br />
              กรุณากดขอลิงก์ใหม่อีกครั้ง
            </p>
            <Link href="/shop/forgot" className="btn-primary mt-4 w-full">
              ขอลิงก์ใหม่
            </Link>
          </>
        )}

        <p className="mt-4 text-center text-sm">
          <Link href="/shop/login" className="text-brand-400 underline">
            กลับไปหน้าเข้าสู่ระบบ
          </Link>
        </p>
      </div>
    </div>
  )
}
