import 'server-only'
import { cache } from 'react'
import { q, q1 } from './db'
import { supabaseServer } from './supabase'

/** ค่าตั้งค่าหน้าเว็บที่แก้ได้จากหลังร้าน */
export const SITE_KEYS = [
  {
    key: 'allow_register',
    label: 'ให้ลูกค้าสมัครบัญชีเองได้',
    placeholder: '',
    options: [
      { value: 'on', label: 'เปิด — ลูกค้าสมัครเองได้ที่หน้าเว็บ' },
      { value: 'off', label: 'ปิด — ร้านเปิดบัญชีให้เท่านั้น' },
    ],
  },
  {
    key: 'shop_cover',
    label: 'ภาพพื้นหลังแถบเมนูด้านบน',
    placeholder: '',
    image: true as const,
  },
  {
    key: 'shop_bg',
    label: 'ภาพพื้นหลังหน้าเว็บ',
    placeholder: '',
    image: true as const,
  },
  {
    key: 'shop_bg_overlay',
    label: 'ความเข้มของฝ้าทับพื้นหลัง',
    placeholder: '',
    options: [
      { value: 'medium', label: 'กลาง — สมดุลระหว่างเห็นภาพกับอ่านง่าย' },
      { value: 'light', label: 'จาง — เห็นภาพชัด แต่ตัวหนังสืออ่านยากขึ้น' },
      { value: 'dark', label: 'เข้ม — อ่านง่ายที่สุด ภาพจางลง' },
    ],
  },
  { key: 'shop_tagline', label: 'ข้อความใต้ชื่อร้าน', placeholder: 'เติมเกมไว ราคาถูก บริการ 24 ชม.' },
  {
    key: 'points_per_baht',
    label: 'กี่เครดิตเท่ากับ 1 บาท',
    placeholder: '100 (ค่าเริ่มต้น — 100 เครดิต = 1 บาท)',
  },

  // เกมที่เติมด้วยลิงก์ แต่ละค่ายเอาลิงก์มาจากคนละที่
  // เขียนวิธีของแต่ละค่ายไว้ตรงนี้ ระบบจะเลือกแสดงให้ตรงกับเกมที่ลูกค้าเปิดอยู่เอง
  {
    key: 'link_hint_oneone',
    label: 'วิธีเอาลิงก์ — เกมค่าย OneOne',
    placeholder: 'เช่น เข้าหน้าเติมเงินในเกม กดแชร์ แล้วคัดลอกลิงก์มาวาง',
  },
  {
    key: 'link_hint_goc',
    label: 'วิธีเอาลิงก์ — เกมค่าย GOC',
    placeholder: 'เขียนขั้นตอนสั้น ๆ ให้ลูกค้าทำตามได้',
  },
  {
    key: 'link_hint_razer',
    label: 'วิธีเอาลิงก์ — Razer',
    placeholder: 'เขียนขั้นตอนสั้น ๆ ให้ลูกค้าทำตามได้',
  },
  {
    key: 'link_hint_default',
    label: 'วิธีเอาลิงก์ — ค่ายอื่น ๆ',
    placeholder: 'ใช้กับเกมที่ไม่เข้าพวกสามค่ายด้านบน',
  },
  { key: 'announcement', label: 'ประกาศแถบบนสุด', placeholder: 'เว้นว่างถ้าไม่ต้องการแสดง' },
  { key: 'bank_name', label: 'ธนาคารที่ให้ลูกค้าโอนเข้า', placeholder: 'เช่น กสิกรไทย' },
  { key: 'bank_account_no', label: 'เลขที่บัญชี', placeholder: 'xxx-x-xxxxx-x' },
  { key: 'bank_account_name', label: 'ชื่อบัญชี', placeholder: 'ชื่อ-นามสกุล เจ้าของบัญชี' },
  { key: 'promptpay', label: 'พร้อมเพย์ (ถ้ามี)', placeholder: 'เบอร์โทร หรือเลขบัตรประชาชน' },
  { key: 'payment_qr', label: 'QR Code รับเงิน', placeholder: '', image: true as const },
  { key: 'topup_note', label: 'ข้อความแจ้งลูกค้าตอนเติมเครดิต', placeholder: 'เช่น โอนแล้วแนบสลิป รอไม่เกิน 10 นาที' },
  { key: 'contact_line', label: 'LINE (ใส่ @id หรือลิงก์ก็ได้)', placeholder: '@payjung' },
  {
    key: 'contact_line_qr',
    label: 'QR Code ของ LINE',
    placeholder: '',
    image: true as const,
  },
  {
    key: 'contact_facebook',
    label: 'Facebook (ใส่ชื่อเพจหรือลิงก์ก็ได้)',
    placeholder: 'https://facebook.com/payjung',
  },
  { key: 'contact_phone', label: 'เบอร์โทร', placeholder: '08x-xxx-xxxx' },
  { key: 'contact_note', label: 'เวลาทำการ / หมายเหตุ', placeholder: 'เปิดทุกวัน 09:00 - 22:00' },
] as const

export type SiteSettings = Record<string, string>

/** ภาพพื้นหลังหน้าเว็บ — ถ้ายังไม่ได้อัปโหลดเอง ใช้ภาพที่ติดมากับระบบ */
export const DEFAULT_SHOP_BG = '/shop-bg.jpg'

export function shopBackground(settings: SiteSettings) {
  return settings.shop_bg || DEFAULT_SHOP_BG
}

/** ภาพพื้นหลังของแถบเมนูด้านบน — ถ้ายังไม่ได้อัปโหลดเอง ใช้ไฟล์ที่ติดมากับระบบ */
export const DEFAULT_SHOP_COVER = '/shop-cover.jpg'

export function shopCover(settings: SiteSettings) {
  return settings.shop_cover || DEFAULT_SHOP_COVER
}

/**
 * ความเข้มของฝ้าที่ทับพื้นหลัง
 * เขียนคลาสเต็ม ๆ ไว้ทุกตัว เพราะ Tailwind ต้องเห็นชื่อคลาสตรง ๆ ในโค้ดถึงจะสร้าง CSS ให้
 */
const OVERLAY_CLASSES = {
  light: 'from-ink-950/10 via-ink-950/30 to-ink-950/65',
  medium: 'from-ink-950/30 via-ink-950/50 to-ink-950/80',
  dark: 'from-ink-950/60 via-ink-950/78 to-ink-950/92',
} as const

export function shopOverlayClass(settings: SiteSettings) {
  const key = settings.shop_bg_overlay
  if (key === 'light' || key === 'dark') return OVERLAY_CLASSES[key]
  return OVERLAY_CLASSES.medium
}

/**
 * สร้างลิงก์เพิ่มเพื่อน LINE จาก @id หรือคืนลิงก์เดิมถ้ากรอกมาเป็นลิงก์อยู่แล้ว
 *
 * ใช้ page.line.me ไม่ใช่ line.me/R/ti/p/@id
 * ตัวหลังเป็นลิงก์สำหรับสั่งให้ "แอป" LINE เปิดหน้าโปรไฟล์ พอกดบนคอมที่ไม่มีแอป
 * จะขึ้น 404 Not Found ส่วน page.line.me เป็นหน้าเว็บจริง เปิดได้ทุกเครื่อง
 * และมีทั้งปุ่มเพิ่มเพื่อนกับ QR อยู่ในหน้าเดียว
 */
export function lineLink(value?: string | null) {
  if (!value) return null
  if (/^https?:\/\//i.test(value)) return value
  const id = value.trim().replace(/^@/, '')
  return id ? `https://page.line.me/${encodeURIComponent(id)}` : null
}

/** สร้างลิงก์เพจ Facebook จากชื่อเพจ หรือคืนลิงก์เดิมถ้ากรอกมาเป็นลิงก์อยู่แล้ว */
export function facebookLink(value?: string | null) {
  if (!value) return null
  if (/^https?:\/\//i.test(value)) return value
  const name = value.trim().replace(/^@/, '')
  return name ? `https://www.facebook.com/${encodeURIComponent(name)}` : null
}

/**
 * อัตราแลกเครดิตเป็นยอดเงิน — กี่เครดิตเท่ากับ 1 บาท
 * ค่าเริ่มต้น 100 (100 เครดิต = 1 บาท) ตั้งใหม่ได้จากหน้าจัดการเว็บไซต์
 * กันค่าเพี้ยนไว้ด้วย เพราะถ้าเผลอตั้งเป็น 0 การหารจะพัง และถ้าติดลบจะแจกเงินฟรี
 */
export function pointsPerBaht(settings: SiteSettings) {
  const n = Number(settings.points_per_baht)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 100
}

/** เปิดให้ลูกค้าสมัครเองไหม — ไม่เคยตั้งค่า = เปิดไว้ */
export function registrationOpen(settings: SiteSettings) {
  return (settings.allow_register ?? 'on') !== 'off'
}

export const getSiteSettings = cache(async function getSiteSettings(): Promise<SiteSettings> {
  const rows = await q<{ key: string; value: string | null }>('select key, value from site_settings')
  const out: SiteSettings = {}
  for (const r of rows) if (r.value) out[r.key] = r.value
  return out
})

export type ShopCustomer = {
  id: number
  name: string
  credit: number
  phone: string | null
  game_uid: string | null
  email: string
  /** เครดิต (แต้ม) แยกจากยอดเงินที่ใช้ซื้อของ — ได้จากการแลกโค้ด */
  points: number
  /** 'partner' = ได้ราคาพาร์ทเนอร์ (ถ้าแพ็กนั้นตั้งไว้), อย่างอื่น = ราคาปกติ */
  tier: string
}

/** ลูกค้ารายนี้ได้ราคาพาร์ทเนอร์ไหม */
export function isPartner(customer: { tier: string } | null | undefined) {
  return customer?.tier === 'partner'
}

/**
 * นิพจน์ SQL ของ "ราคาที่ลูกค้ารายนี้ต้องจ่าย"
 *
 * เขียนไว้ที่เดียวแล้วเรียกใช้ทุกหน้า เพราะราคาที่โชว์กับราคาที่ตัดเงินจริง
 * ต้องมาจากสูตรเดียวกันเป๊ะ ๆ ไม่งั้นลูกค้าเห็นราคาหนึ่งแต่โดนตัดอีกราคาหนึ่ง
 *
 * ใช้ราคาที่ "เผยแพร่แล้ว" เท่านั้น ราคาที่เพิ่งแก้ในหลังร้านจะยังไม่มีผลกับลูกค้า
 * จนกว่าจะกดปุ่มอัปเดตราคาขึ้นหน้าเว็บ (coalesce ไว้กันกรณีแพ็กใหม่ที่ยังไม่เคยเผยแพร่)
 */
export function priceExpr(partner: boolean, alias = 'p') {
  const normal = `coalesce(${alias}.published_sell_price, ${alias}.sell_price)`
  return partner
    ? `coalesce(${alias}.published_partner_price, ${normal})`
    : normal
}

/**
 * ลูกค้าที่ล็อกอินอยู่บนหน้าเว็บ
 * ใช้ Supabase Auth ตัวเดียวกับพนักงาน แต่แยกกันด้วยว่ามีแถวใน customers ไหม
 * ร้านเป็นคนสร้างบัญชีให้ ลูกค้าสมัครเองไม่ได้
 */
export const getShopCustomer = cache(async function getShopCustomer(): Promise<ShopCustomer | null> {
  try {
    const supabase = await supabaseServer()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return null

    const row = await q1<Omit<ShopCustomer, 'email'>>(
      `select id, name, credit::float8 as credit, phone, game_uid, tier,
              points::float8 as points
         from customers where auth_user_id = $1 and web_enabled limit 1`,
      [user.id]
    )
    if (!row) return null
    return { ...row, email: user.email ?? '' }
  } catch {
    // ยังตั้งค่าไม่ครบ หรือฐานข้อมูลมีปัญหา — ถือว่ายังไม่ล็อกอิน
    return null
  }
})
