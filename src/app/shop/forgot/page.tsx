import Link from 'next/link'
import { requestPasswordResetAction } from '@/lib/actions/account'
import { ActionForm, SubmitButton } from '@/components/ActionForm'

export const dynamic = 'force-dynamic'

export default function ShopForgotPage() {
  return (
    <div className="mx-auto max-w-sm py-6">
      <h1 className="text-center text-xl font-bold text-fg">ลืมรหัสผ่าน</h1>
      <p className="mt-1 text-center text-sm text-mute">
        กรอกอีเมลที่ใช้สมัคร เราจะส่งลิงก์ตั้งรหัสผ่านใหม่ไปให้
      </p>

      <div className="card mt-6 border-ink-700/70 bg-ink-900/75 backdrop-blur-md">
        <ActionForm action={requestPasswordResetAction} className="space-y-4">
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
          <SubmitButton className="btn-primary w-full" pendingLabel="กำลังส่ง...">
            ส่งลิงก์ตั้งรหัสผ่านใหม่
          </SubmitButton>
        </ActionForm>

        <p className="mt-4 text-center text-xs leading-relaxed text-mute">
          ลิงก์มีอายุจำกัด ถ้าไม่ได้รับอีเมลภายใน 5 นาที ลองเช็กโฟลเดอร์ Junk / Spam
          หรือติดต่อทางร้านได้เลย
        </p>

        <p className="mt-3 text-center text-sm">
          <Link href="/shop/login" className="text-brand-400 underline">
            กลับไปหน้าเข้าสู่ระบบ
          </Link>
        </p>
      </div>
    </div>
  )
}
