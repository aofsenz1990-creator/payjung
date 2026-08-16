/**
 * สัญญากลางของ "ผู้ให้บริการเติมเกม" ทุกเจ้า
 *
 * เพิ่มเจ้าใหม่ = เขียนไฟล์ adapter หนึ่งไฟล์ให้ครบสามฟังก์ชันนี้ แล้วลงทะเบียนใน registry.ts
 * ส่วนที่เหลือ (ตัดเครดิต ล็อกกันส่งซ้ำ ตามสถานะ คืนเงิน) ใช้ของกลางร่วมกันหมด
 * ไม่ต้องแก้อะไรอีก
 */

/** ข้อมูลบัญชีร้านเราที่ผู้ให้บริการเจ้านั้น — อ่านมาจากตาราง api_providers */
export type ProviderConfig = {
  id: number
  name: string
  kind: string
  baseUrl: string | null
  /** ผู้ให้บริการที่ใช้ ID + รหัสผ่าน จะมีค่านี้ ส่วนเจ้าที่ใช้คีย์เดี่ยวจะเป็น null */
  username: string | null
  /** คีย์ หรือรหัสผ่าน แล้วแต่ชนิดของเจ้านั้น */
  secret: string
}

/** สิ่งที่ต้องบอกปลายทางเวลาสั่งเติมหนึ่งรายการ */
export type OrderInput = {
  /** เลขอ้างอิงของเรา (ใช้เลขบิล) ปลายทางควรใช้ตัวนี้กันสั่งซ้ำ */
  ref: string
  /** รหัสเกมฝั่งปลายทาง */
  gameId: string
  /** รหัสเซิร์ฟเวอร์ฝั่งปลายทาง ('0' ถ้าเกมนั้นไม่มีเซิร์ฟเวอร์) */
  serverId: string
  /** รหัสแพ็กเกจฝั่งปลายทาง */
  sku: string
  quantity: number
  /** ไอดีเกมของลูกค้าที่จะเติมเข้าไป */
  account: string
}

/** ผลของการยิงคำสั่งเติม — ได้แค่ "ปลายทางรับเรื่องแล้ว" ยังไม่ใช่ "เติมสำเร็จ" */
export type PlaceResult = {
  /** เลขออเดอร์ฝั่งปลายทาง เก็บไว้ใช้ตามสถานะ */
  orderId: string | null
  message: string
}

/**
 * สถานะออเดอร์ฝั่งปลายทาง
 * - `sent`    ยังไม่จบ (อยู่ในคิว/กำลังเติม) ให้ตามต่อรอบหน้า
 * - `success` เติมเข้าเกมเรียบร้อย
 * - `failed`  ปลายทางแจ้งว่าล้มเหลว — ระบบจะคืนเครดิตลูกค้าให้อัตโนมัติ
 * - `missing` ปลายทางไม่รู้จักออเดอร์นี้เลย = คำสั่งไม่เคยเข้าไป ส่งใหม่ได้อย่างปลอดภัย
 */
export type OrderState = 'sent' | 'success' | 'failed' | 'missing'

export type CheckResult = {
  state: OrderState
  message: string
  /** ปลายทางอาจเพิ่งบอกเลขออเดอร์ตอนนี้ (กรณีตามด้วยเลขอ้างอิงของเรา) */
  orderId?: string | null
}

/** ยอดกระเป๋าเงินของร้านเราที่ผู้ให้บริการเจ้านั้น */
export type BalanceResult = {
  balance: number
  /** หน่วยที่เจ้านั้นเรียก เช่น 'พอยต์' หรือ 'บาท' */
  unit: string
  /** ชื่อบัญชีร้านเราฝั่งปลายทาง ใช้ยืนยันว่าต่อถูกบัญชี */
  account: string | null
}

/**
 * ข้อผิดพลาดที่ "รู้สาเหตุแล้ว" และเอาข้อความไปแสดงให้คนหลังร้านอ่านได้เลย
 * ถ้าเป็น error ชนิดอื่นแปลว่าเป็นบั๊กของเรา ไม่ใช่ปัญหาปลายทาง
 */
export class ProviderError extends Error {
  /** true = ลองใหม่แล้วมีโอกาสสำเร็จ (เน็ตสะดุด/ปลายทางล่มชั่วคราว) */
  readonly retryable: boolean
  constructor(message: string, retryable = false) {
    super(message)
    this.retryable = retryable
  }
}

export type ProviderAdapter = {
  kind: string
  /** ยอดคงเหลือของร้านเราที่ปลายทาง */
  getBalance(config: ProviderConfig): Promise<BalanceResult>
  /** สั่งเติม — ต้องส่ง ref ไปด้วยเสมอเพื่อให้ตามกลับได้ */
  placeOrder(config: ProviderConfig, input: OrderInput): Promise<PlaceResult>
  /** ตามสถานะด้วยเลขออเดอร์ปลายทาง หรือด้วยเลขอ้างอิงของเราถ้ายังไม่รู้เลขออเดอร์ */
  checkOrder(
    config: ProviderConfig,
    order: { ref: string; orderId: string | null }
  ): Promise<CheckResult>
}
