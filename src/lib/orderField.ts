/**
 * ชนิดของช่องที่ลูกค้าต้องกรอกตอนสั่งเติมเกม
 *
 * ผู้ให้บริการบางเจ้าบอกมาให้เองว่าเกมไหนขออะไร (OverTopup) แต่บางเจ้าไม่บอกเลย
 * (24BUYM ส่งมาแค่รหัสเกมกับรหัสแพ็กเกจ) ทุกเกมของเจ้านั้นจึงขึ้นช่องเดียวกันหมด
 * ว่า "ไอดีเกม / UID" ทั้งที่บางเกมต้องใช้ AID หรือให้วางลิงก์
 *
 * ตารางนี้ให้ร้านเลือกเองรายเกมได้ว่าจะให้ลูกค้ากรอกอะไร พร้อมคำอธิบายที่ตรงกับของจริง
 */

export type OrderFieldSpec = {
  key: string
  /** ชื่อที่ใช้เลือกในหลังร้าน */
  adminLabel: string
  /** ป้ายกำกับช่องบนหน้าเว็บลูกค้า */
  label: string
  placeholder: string
  hint: string
  /** ลิงก์ให้ใช้ช่องแบบ url เพื่อให้มือถือขึ้นแป้นพิมพ์ที่เหมาะกว่า */
  type: 'text' | 'url'
}

export const ORDER_FIELDS: OrderFieldSpec[] = [
  {
    key: 'uid',
    adminLabel: 'ไอดีเกม / UID',
    label: 'ไอดีเกม / UID',
    placeholder: 'เช่น 123456789',
    hint: 'เลขประจำตัวผู้เล่น ดูได้ในหน้าโปรไฟล์ของเกม',
    type: 'text',
  },
  {
    key: 'aid',
    adminLabel: 'AID',
    label: 'AID',
    placeholder: 'เช่น 987654321',
    hint: 'ดูได้ในหน้าโปรไฟล์หรือหน้าตั้งค่าบัญชีของเกม',
    type: 'text',
  },
  {
    key: 'link_oneone',
    adminLabel: 'ลิงก์ — OneOne',
    label: 'ลิงก์เติมเงิน (OneOne)',
    placeholder: 'https://...',
    hint: 'คัดลอกลิงก์เติมเงินจากหน้า OneOne มาวางทั้งลิงก์',
    type: 'url',
  },
  {
    key: 'link_goc',
    adminLabel: 'ลิงก์ — GOC',
    label: 'ลิงก์เติมเงิน (GOC)',
    placeholder: 'https://...',
    hint: 'คัดลอกลิงก์เติมเงินจากหน้า GOC มาวางทั้งลิงก์',
    type: 'url',
  },
  {
    key: 'link_razer',
    adminLabel: 'ลิงก์ — Razer',
    label: 'ลิงก์เติมเงิน (Razer)',
    placeholder: 'https://...',
    hint: 'คัดลอกลิงก์เติมเงินจากหน้า Razer มาวางทั้งลิงก์',
    type: 'url',
  },
  {
    key: 'player_name',
    adminLabel: 'ชื่อตัวละคร',
    label: 'ชื่อตัวละคร',
    placeholder: 'พิมพ์ชื่อตัวละครให้ตรงตัวพิมพ์เล็ก-ใหญ่',
    hint: 'พิมพ์ให้ตรงกับในเกมทุกตัวอักษร ไม่งั้นเติมเข้าผิดคน',
    type: 'text',
  },
]

export const ORDER_FIELD_KEYS = ORDER_FIELDS.map((f) => f.key)

export function orderFieldSpec(key: string | null | undefined) {
  if (!key) return null
  return ORDER_FIELDS.find((f) => f.key === key) ?? null
}
