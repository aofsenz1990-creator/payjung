export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-950 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <span className="mx-auto mb-3 flex size-14 items-center justify-center rounded-2xl bg-linear-to-br from-brand-400 to-brand-600 text-2xl font-bold text-white">
            P
          </span>
          <h1 className="text-xl font-bold text-white">{title}</h1>
          <p className="mt-1 text-sm text-mute">{subtitle}</p>
        </div>
        <div className="card">{children}</div>
        <p className="mt-6 text-center text-xs text-mute">Pay Jung · ระบบภายในร้าน</p>
      </div>
    </main>
  )
}

export function SetupHint({ message }: { message: string }) {
  return (
    <div className="mb-4 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2.5 text-sm text-warn">
      <p className="font-medium">ยังตั้งค่าระบบไม่ครบ</p>
      <p className="mt-1 text-xs leading-relaxed">{message}</p>
    </div>
  )
}
