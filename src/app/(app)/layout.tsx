import { requireUser } from '@/lib/auth'
import { logoutAction } from '@/lib/actions/auth'
import { Nav } from '@/components/Nav'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <Nav
        pages={user.pages}
        user={user.name}
        roleLabel={user.role === 'admin' ? 'ผู้ดูแลระบบ (เห็นทุนและกำไร)' : 'พนักงาน'}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="hidden items-center justify-end gap-3 border-b border-ink-800 bg-ink-900/60 px-8 py-3 lg:flex">
          <span className="text-sm text-mute">
            สวัสดี <span className="font-medium text-white">{user.name}</span>
          </span>
          <form action={logoutAction}>
            <button type="submit" className="btn-ghost btn-sm">
              ออกจากระบบ
            </button>
          </form>
        </header>
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
        <div className="px-4 pb-8 lg:hidden">
          <form action={logoutAction}>
            <button type="submit" className="btn-ghost w-full">
              ออกจากระบบ
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
