/**
 * ส่วน "ทำไมต้องเลือกเรา" บนหน้าแรกของลูกค้า
 *
 * ทุกข้อเขียนจากสิ่งที่ระบบทำได้จริงเท่านั้น ไม่ใส่คำโฆษณาที่พิสูจน์ไม่ได้
 * (เช่นการรับประกันว่าไอดีจะไม่โดนแบน ซึ่งเราคุมไม่ได้จริง ๆ)
 * ลูกค้าที่เจอว่าเว็บเขียนเกินจริงแม้เรื่องเดียว จะไม่เชื่อทั้งหน้าเลย
 */

type Feature = {
  icon: React.ReactNode
  title: string
  body: string
  note: string
  /** สีของกรอบไอคอน ไล่ให้ต่างกันทีละใบ หน้าจะได้ไม่จืด */
  tone: string
}

const FEATURES: Feature[] = [
  {
    tone: 'from-brand-500/25 to-brand-600/10 text-brand-400 ring-brand-500/25',
    title: 'เติมอัตโนมัติ ตลอด 24 ชั่วโมง',
    body: 'กดสั่งซื้อแล้วระบบส่งต่อให้ผู้ให้บริการทันที ไม่ต้องรอร้านออนไลน์ จะตีสองตีสามก็เติมได้',
    note: 'รองรับทั้งเกมที่เติมด้วย UID และเกมที่ต้องเลือกเซิร์ฟเวอร์',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-6">
        <path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12L13 2z" />
      </svg>
    ),
  },
  {
    tone: 'from-good/25 to-good/5 text-good ring-good/25',
    title: 'เติมไม่สำเร็จ คืนเครดิตให้เอง',
    body: 'ถ้าปลายทางเติมไม่ผ่าน ระบบคืนเครดิตเข้าบัญชีคุณอัตโนมัติ ไม่ต้องรอทวงหรือรอร้านตรวจ',
    note: 'เครดิตทุกบาทที่เข้า-ออก มีบันทึกให้ย้อนดูได้ในหน้าบัญชี',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-6">
        <path d="M3 12a9 9 0 1 0 3-6.7" />
        <path d="M3 4v5h5" />
      </svg>
    ),
  },
  {
    tone: 'from-sun/25 to-sun/5 text-sun ring-sun/25',
    title: 'ราคาที่เห็น คือราคาที่จ่าย',
    body: 'ไม่มีค่าธรรมเนียมแอบแฝง ไม่บวกเพิ่มตอนกดจ่าย ราคาบนหน้าเว็บคือยอดที่ตัดจากเครดิตจริง',
    note: 'เห็นยอดคงเหลือก่อนกดยืนยันทุกครั้ง',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-6">
        <path d="M20.6 13.4 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" />
        <circle cx="7.5" cy="7.5" r="1.5" />
      </svg>
    ),
  },
  {
    tone: 'from-grape-500/25 to-grape-600/10 text-grape-400 ring-grape-500/25',
    title: 'ราคาพิเศษสำหรับพาร์ทเนอร์',
    body: 'ซื้อประจำหรือรับไปขายต่อ ทักมาขอสิทธิ์พาร์ทเนอร์ได้ รับราคาต่ำกว่าราคาหน้าร้านปกติ',
    note: 'พอได้สิทธิ์แล้ว ราคาพิเศษจะขึ้นให้เองทันทีที่เข้าสู่ระบบ',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-6">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />
      </svg>
    ),
  },
  {
    tone: 'from-aqua-500/25 to-aqua-500/5 text-aqua-400 ring-aqua-500/25',
    title: 'ดูแลเรื่องความปลอดภัย',
    body: 'เชื่อมต่อผ่านการเข้ารหัสทั้งเว็บ มีระบบกันเดารหัสผ่าน และข้อมูลลูกค้าไม่เปิดให้ใครดึงไปได้',
    note: 'ตั้งรหัสผ่านใหม่และแก้ข้อมูลของตัวเองได้ตลอดจากหน้าบัญชี',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-6">
        <path d="M12 22s8-3.5 8-9.5V5.5L12 2 4 5.5V12.5C4 18.5 12 22 12 22z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
  },
  {
    tone: 'from-brand-400/25 to-grape-500/10 text-brand-400 ring-brand-400/25',
    title: 'ติดต่อได้จริง มีคนตอบ',
    body: 'ทักทาง LINE ได้ตลอดเวลา และร้านส่งข้อความหาคุณผ่านกล่องข้อความในเว็บโดยตรง',
    note: 'ประวัติการสั่งซื้อย้อนหลังดูได้เองทุกเมื่อ ไม่ต้องถามร้าน',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-6">
        <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
        <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
      </svg>
    ),
  },
]

export function WhyUs() {
  return (
    <section className="mb-10">
      <div className="mb-6 text-center">
        <p className="text-sm font-semibold text-brand-400">ทำไมต้องเติมกับเรา</p>
        <h2 className="neon-title mt-1 text-2xl font-extrabold sm:text-3xl">
          ครบ จบ ในที่เดียว
        </h2>
        <p className="mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-mute">
          ระบบเติมเกมที่ทำงานเองตลอดเวลา พร้อมประวัติทุกรายการที่ตรวจสอบย้อนหลังได้
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <article
            key={f.title}
            className="group rounded-2xl border border-ink-700/70 bg-linear-to-b from-ink-900/80 to-ink-950/70 p-5 backdrop-blur-sm transition duration-300 hover:-translate-y-1 hover:border-brand-500/50 hover:shadow-[0_10px_30px_-12px] hover:shadow-brand-500/40"
          >
            <div
              className={`mb-3 inline-flex size-11 items-center justify-center rounded-xl bg-linear-to-br ring-1 ${f.tone}`}
            >
              {f.icon}
            </div>
            <h3 className="text-base font-semibold text-white">{f.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-300">{f.body}</p>
            <p className="mt-2 text-xs leading-relaxed text-mute">{f.note}</p>
          </article>
        ))}
      </div>
    </section>
  )
}
