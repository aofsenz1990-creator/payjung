import { requireUser } from '@/lib/auth'
import { logoutAction } from '@/lib/actions/auth'

export const dynamic = 'force-dynamic'

export default async function NoAccessPage() {
  const user = await requireUser()

  return (
    <div className="mx-auto max-w-lg py-10">
      <div className="card text-center">
        <p className="text-4xl">🔒</p>
        <h1 className="mt-3 text-lg font-bold text-white">ยังไม่ได้รับสิทธิ์ใช้งาน</h1>
        <p className="mt-2 text-sm leading-relaxed text-mute">
          บัญชี <span className="text-white">{user.name}</span> ({user.email})
          ยังไม่ได้รับสิทธิ์เข้าถึงเมนูใดเลย
          <br />
          กรุณาติดต่อผู้ดูแลระบบให้เปิดสิทธิ์ที่หน้า “ผู้ใช้งานระบบ”
        </p>
        <form action={logoutAction} className="mt-5">
          <button type="submit" className="btn-ghost">
            ออกจากระบบ
          </button>
        </form>
      </div>
    </div>
  )
}
