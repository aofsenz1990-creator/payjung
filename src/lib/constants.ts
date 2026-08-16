export const PAYMENT_METHODS = [
  'เงินสด',
  'โอนธนาคาร',
  'พร้อมเพย์',
  'TrueMoney Wallet',
  'บัตรเครดิต',
  'อื่น ๆ',
] as const

/** ลูกค้ามาจากช่องทางไหน — แก้รายการนี้ได้ตามช่องทางที่ร้านใช้จริง */
export const CUSTOMER_SOURCES = ['Facebook', 'LINE'] as const

/** ช่องทางที่ใช้ติดต่อลูกค้าตอนโอนเงินคืน */
export const CLAIM_CHANNELS = ['Facebook', 'LINE'] as const

export const EXPENSE_CATEGORIES = [
  'ค่าเช่าร้าน',
  'ค่าน้ำ/ค่าไฟ',
  'ค่าอินเทอร์เน็ต',
  'เงินเดือนพนักงาน',
  'ค่าโฆษณา/การตลาด',
  'ค่าธรรมเนียม/ค่าโอน',
  'อุปกรณ์/ของใช้ในร้าน',
  'อื่น ๆ',
] as const

export const SALE_STATUS = {
  paid: 'สำเร็จ',
  pending: 'รอดำเนินการ',
  cancelled: 'ยกเลิก',
} as const

export type SaleStatus = keyof typeof SALE_STATUS

/**
 * สถานะการส่งออเดอร์ต่อไปยังผู้ให้บริการ (เก็บใน sales.provider_state)
 * อยู่ที่นี่เพราะทั้งฝั่งเซิร์ฟเวอร์และหน้าจอต้องใช้ร่วมกัน
 */
export const DISPATCH_STATE = {
  queued: 'รอส่งให้ผู้ให้บริการ',
  sending: 'กำลังส่ง...',
  sent: 'ปลายทางรับแล้ว กำลังเติม',
  success: 'เติมสำเร็จ',
  failed: 'ปลายทางเติมไม่สำเร็จ',
  error: 'ส่งไม่สำเร็จ ต้องตรวจสอบ',
  manual: 'ต้องเติมเอง',
} as const

export type DispatchState = keyof typeof DISPATCH_STATE

export const DISPATCH_TONE: Record<DispatchState, 'good' | 'bad' | 'warn' | 'neutral'> = {
  queued: 'warn',
  sending: 'warn',
  sent: 'warn',
  success: 'good',
  failed: 'bad',
  error: 'bad',
  manual: 'neutral',
}

export const STOCK_KIND = {
  in: 'รับเข้า',
  out: 'ตัดออก',
  adjust: 'ปรับยอด',
} as const

export const SHOP_NAME = 'Pay Jung'
