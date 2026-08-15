import { BrandLogo } from './Brand'

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
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-ink-950 px-4 py-10">
      {/* แสงไล่สีชมพู-ม่วงตามโลโก้ */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 size-[36rem] -translate-x-1/2 rounded-full bg-brand-500/20 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-48 right-0 size-[30rem] rounded-full bg-grape-500/20 blur-3xl"
      />

      <div className="relative w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-5 w-fit">
            <BrandLogo />
          </div>
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
