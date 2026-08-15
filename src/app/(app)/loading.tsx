/**
 * โครงหน้าเปล่าที่ขึ้นทันทีตอนกดเปลี่ยนหน้า
 * ทุกหน้าดึงข้อมูลสดจากฐานข้อมูล ถ้าไม่มีอันนี้เบราว์เซอร์จะค้างอยู่หน้าเดิมเงียบ ๆ
 * จนกว่าเซิร์ฟเวอร์จะตอบ ทำให้รู้สึกว่าระบบช้าทั้งที่จริง ๆ กำลังโหลดอยู่
 */
export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="h-7 w-56 rounded-lg bg-ink-800" />
          <div className="mt-2 h-4 w-72 rounded bg-ink-850" />
        </div>
        <div className="h-9 w-32 rounded-lg bg-ink-800" />
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card">
            <div className="h-3 w-24 rounded bg-ink-800" />
            <div className="mt-3 h-7 w-32 rounded-lg bg-ink-800" />
            <div className="mt-2 h-3 w-20 rounded bg-ink-850" />
          </div>
        ))}
      </div>

      <div className="card">
        <div className="mb-4 h-4 w-40 rounded bg-ink-800" />
        <div className="space-y-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-8 w-full rounded-lg bg-ink-850" />
          ))}
        </div>
      </div>

      <p className="mt-6 text-center text-xs text-mute">กำลังโหลดข้อมูล...</p>
    </div>
  )
}
