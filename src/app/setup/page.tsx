import { redirect } from 'next/navigation'
import { countUsers } from '@/lib/auth'
import { setupAction } from '@/lib/actions/auth'
import { ActionForm, SubmitButton } from '@/components/ActionForm'
import { AuthShell, SetupHint } from '@/components/AuthShell'

export const dynamic = 'force-dynamic'

export default async function SetupPage() {
  let configError: string | null = null
  try {
    if ((await countUsers()) > 0) redirect('/login')
  } catch (err) {
    if (err && typeof err === 'object' && 'digest' in err) throw err
    configError = err instanceof Error ? err.message : String(err)
  }

  return (
    <AuthShell title="ตั้งค่าครั้งแรก" subtitle="สร้างบัญชีผู้ดูแลระบบของร้าน Pay Jung">
      {configError ? (
        <SetupHint message={configError} />
      ) : (
        <p className="mb-4 rounded-lg border border-brand-500/30 bg-brand-500/10 px-3 py-2.5 text-xs leading-relaxed text-brand-400">
          บัญชีแรกจะได้สิทธิ์ผู้ดูแลระบบโดยอัตโนมัติ และระบบจะใส่รายชื่อเกมยอดนิยมไว้ให้ตั้งต้น
          หน้านี้จะใช้ได้ครั้งเดียวเท่านั้น
        </p>
      )}
      <ActionForm action={setupAction} className="space-y-4">
        <div>
          <label className="label" htmlFor="display_name">
            ชื่อที่แสดง
          </label>
          <input
            id="display_name"
            name="display_name"
            className="input"
            placeholder="เช่น เจ้าของร้าน"
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="username">
            ชื่อผู้ใช้ (ใช้ล็อกอิน)
          </label>
          <input
            id="username"
            name="username"
            className="input"
            autoComplete="username"
            placeholder="เช่น admin"
            required
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
        <SubmitButton className="btn-primary w-full" pendingLabel="กำลังสร้างบัญชี...">
          สร้างบัญชีผู้ดูแล
        </SubmitButton>
      </ActionForm>
    </AuthShell>
  )
}
