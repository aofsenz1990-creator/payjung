/**
 * ทะเบียนเมนูทั้งหมดในระบบ — ใช้ร่วมกันทั้งเมนูฝั่งเบราว์เซอร์และการตรวจสิทธิ์ฝั่งเซิร์ฟเวอร์
 * ไฟล์นี้ต้องไม่พึ่งพาอะไรฝั่งเซิร์ฟเวอร์ เพราะ Nav ซึ่งเป็น client component ก็ import ไปใช้
 */

export type PageKey =
  | 'dashboard'
  | 'sales'
  | 'daily'
  | 'history'
  | 'games'
  | 'stock'
  | 'customers'
  | 'claims'
  | 'topups'
  | 'credit-codes'
  | 'storefront'
  | 'expenses'
  | 'users'

export type PageDef = {
  key: PageKey
  href: string
  label: string
  icon: string
  /** เมนูที่ให้เฉพาะผู้ดูแลระบบ มอบให้พนักงานไม่ได้ */
  adminOnly?: boolean
  hint: string
}

export const PAGES: PageDef[] = [
  { key: 'dashboard', href: '/', label: 'แดชบอร์ดสรุปยอด', icon: '📊', hint: 'ยอดขาย กำไร กราฟรายวัน' },
  { key: 'sales', href: '/sales', label: 'ลงยอดขาย', icon: '🧾', hint: 'บันทึกบิลเติมเกม' },
  { key: 'daily', href: '/daily', label: 'สรุปยอดขายรายวัน', icon: '📅', hint: 'ยอดแยกรายวันทั้งเดือน' },
  { key: 'history', href: '/history', label: 'ประวัติการเติม', icon: '🕘', hint: 'ค้นหาย้อนหลัง + ดาวน์โหลด CSV' },
  { key: 'games', href: '/games', label: 'รายชื่อเกม & แพ็กเกจ', icon: '🎮', hint: 'จัดการเกมและราคา' },
  { key: 'stock', href: '/stock', label: 'ระบบสต๊อก', icon: '📦', hint: 'รับเข้า ตัดออก ปรับยอด' },
  { key: 'customers', href: '/customers', label: 'รายชื่อลูกค้า', icon: '👥', hint: 'ข้อมูลติดต่อและยอดซื้อ' },
  { key: 'topups', href: '/topups', label: 'อนุมัติเติมเครดิต', icon: '💰', hint: 'ลูกค้าแจ้งโอนเงินเข้ามา' },
  { key: 'claims', href: '/claims', label: 'เคลม / คืนเงิน', icon: '↩️', hint: 'เติมไม่สำเร็จ ต้องโอนคืนลูกค้า' },
  {
    key: 'credit-codes',
    href: '/credit-codes',
    label: 'โค้ดเครดิต',
    icon: '🎟️',
    adminOnly: true,
    hint: 'สร้างโค้ดให้ลูกค้าแลกเป็นเครดิต',
  },
  {
    key: 'storefront',
    href: '/storefront',
    label: 'จัดการหน้าเว็บไซต์',
    icon: '🛒',
    adminOnly: true,
    hint: 'เฉพาะผู้ดูแลระบบ',
  },
  {
    key: 'expenses',
    href: '/expenses',
    label: 'ค่าใช้จ่ายรายเดือน',
    icon: '💸',
    adminOnly: true,
    hint: 'เฉพาะผู้ดูแลระบบ',
  },
  {
    key: 'users',
    href: '/users',
    label: 'ผู้ใช้งานระบบ',
    icon: '🔐',
    adminOnly: true,
    hint: 'เฉพาะผู้ดูแลระบบ',
  },
]

/** เมนูที่พนักงานเลือกให้ได้ (ตัดเมนูของผู้ดูแลระบบออก) */
export const ASSIGNABLE_PAGES = PAGES.filter((p) => !p.adminOnly)

/** ค่าเริ่มต้นของพนักงานที่ยังไม่เคยกำหนดสิทธิ์เอง */
export const DEFAULT_STAFF_PAGES: PageKey[] = ASSIGNABLE_PAGES.map((p) => p.key)

export const ALL_PAGE_KEYS: PageKey[] = PAGES.map((p) => p.key)

export function isPageKey(value: string): value is PageKey {
  return (ALL_PAGE_KEYS as string[]).includes(value)
}

export function pageByKey(key: PageKey) {
  return PAGES.find((p) => p.key === key)
}

/**
 * คำนวณเมนูที่ผู้ใช้เข้าถึงได้
 * - ผู้ดูแลระบบเห็นทุกเมนูเสมอ
 * - พนักงานเห็นตามที่กำหนดไว้ ถ้ายังไม่เคยกำหนดจะใช้ค่าเริ่มต้น
 */
export function resolvePages(role: 'admin' | 'staff', allowed: string[] | null): PageKey[] {
  if (role === 'admin') return ALL_PAGE_KEYS
  const source = allowed && allowed.length > 0 ? allowed : allowed === null ? DEFAULT_STAFF_PAGES : []
  return ASSIGNABLE_PAGES.filter((p) => source.includes(p.key)).map((p) => p.key)
}

/** หน้าแรกที่ควรพาไปหลังล็อกอิน หรือเวลาถูกกันออกจากหน้าที่ไม่มีสิทธิ์ */
export function landingHref(pages: PageKey[]) {
  if (pages.includes('dashboard')) return '/'
  const first = PAGES.find((p) => pages.includes(p.key))
  return first?.href ?? '/no-access'
}
