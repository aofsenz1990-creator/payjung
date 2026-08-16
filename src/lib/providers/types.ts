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
  /** ยิงเข้าสภาพแวดล้อมทดสอบของผู้ให้บริการแทนของจริง (ไม่เสียเงิน) */
  sandbox: boolean
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
  /** ไอดีเกมของลูกค้าที่จะเติมเข้าไป (ใช้เมื่อเกมนั้นต้องการค่าเดียว) */
  account: string
  /**
   * ค่าที่ลูกค้ากรอกตามช่องที่เกมนั้นบังคับ เช่น { uid: '123', server: '1' }
   * ถ้ามีค่านี้ให้ใช้แทน account เพราะครบกว่า
   */
  fields?: Record<string, string> | null
  /**
   * ชนิดสินค้าฝั่งปลายทาง (เจ้าที่แยกประเภทอย่าง OverTopup ต้องใช้)
   * เช่น 'gtopup_uid' = เติมด้วย UID, 'card' = บัตรเงินสด
   */
  productType?: string | null
  /**
   * URL ที่ให้ปลายทางยิงผลกลับมา — เจ้าที่บังคับฟิลด์นี้จะส่งค่ามาให้เสมอ
   * ตัวเชื่อมที่ไม่ใช้ก็ไม่ต้องสนใจ
   */
  callbackUrl?: string | null
  /**
   * ราคาทุนต่อหน่วยที่ระบบเราบันทึกไว้
   * เจ้าที่รับค่านี้จะเอาไปเทียบกับราคาปัจจุบัน ถ้าไม่ตรงจะปฏิเสธออเดอร์
   * แทนที่จะตัดเงินตามราคาใหม่เงียบ ๆ — กันขายขาดทุนโดยไม่รู้ตัว
   */
  unitPrice?: number | null
}

/** ผลของการยิงคำสั่งเติม — ได้แค่ "ปลายทางรับเรื่องแล้ว" ยังไม่ใช่ "เติมสำเร็จ" */
export type PlaceResult = {
  /** เลขออเดอร์ฝั่งปลายทาง เก็บไว้ใช้ตามสถานะ */
  orderId: string | null
  message: string
}

/**
 * สถานะออเดอร์ฝั่งปลายทาง
 * - `sent`      ยังไม่จบ (อยู่ในคิว/กำลังเติม) ให้ตามต่อรอบหน้า
 * - `success`   เติมเข้าเกมเรียบร้อย
 * - `failed`    ปลายทางแจ้งว่าล้มเหลวแน่นอน — ระบบจะคืนเครดิตลูกค้าให้อัตโนมัติ
 * - `attention` จบแล้วแต่มีปัญหา ยังสรุปไม่ได้ว่าเติมเข้าหรือไม่ — ต้องให้คนตรวจ ห้ามคืนเงินเอง
 * - `missing`   ปลายทางไม่รู้จักออเดอร์นี้เลย = คำสั่งไม่เคยเข้าไป ส่งใหม่ได้อย่างปลอดภัย
 * - `unknown`   ตรวจสอบไม่ได้ (เช่นไม่มีเลขออเดอร์ และปลายทางค้นด้วยเลขอ้างอิงของเราไม่ได้)
 *               **ห้ามส่งใหม่เด็ดขาด** เพราะอาจกลายเป็นเติมสองรอบ
 */
export type OrderState = 'sent' | 'success' | 'failed' | 'attention' | 'missing' | 'unknown'

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

/**
 * ช่องที่เกมหนึ่งบังคับให้กรอกตอนสั่งเติม
 * บางเกมต้องการแค่ UID บางเกมต้องเลือกเซิร์ฟเวอร์/ภูมิภาคด้วย
 * ถ้าไม่ส่งให้ครบ ออเดอร์จะถูกปฏิเสธ หรือแย่กว่านั้นคือเติมผิดเซิร์ฟเวอร์
 */
export type ProviderField = {
  key: string
  label: string
  /** มีตัวเลือกให้เลือก = ต้องแสดงเป็นดรอปดาวน์ ไม่ใช่ช่องพิมพ์อิสระ */
  options?: Array<{ value: string; label: string }>
}

/** หนึ่งรายการสินค้าที่ดึงมาจากผู้ให้บริการ — แผ่เป็นแถวเดียวต่อสินค้าหนึ่งชิ้นแล้ว */
export type CatalogEntry = {
  gameId: string
  gameName: string
  /** เกมที่ไม่มีเซิร์ฟเวอร์ให้ใช้ '0' */
  serverId: string
  serverName: string | null
  sku: string
  packName: string
  packDesc: string
  price: number
  /** ชนิดสินค้าฝั่งปลายทาง ถ้าเจ้านั้นแยกประเภท */
  productType?: string | null
  /** ช่องที่เกมนี้บังคับให้กรอก (เหมือนกันทุกแพ็กเกจของเกมเดียวกัน) */
  fields?: ProviderField[] | null
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
    order: { ref: string; orderId: string | null; productType?: string | null }
  ): Promise<CheckResult>
  /**
   * ดึงรายการสินค้าทั้งหมดมาเก็บไว้ให้เลือกจับคู่
   * ไม่ใส่ก็ได้ — เจ้าที่ไม่มีจะต้องกรอกรหัสสินค้าเองที่หน้าแพ็กเกจ
   */
  fetchCatalog?(config: ProviderConfig, opts: { vip: boolean }): Promise<CatalogEntry[]>
}
