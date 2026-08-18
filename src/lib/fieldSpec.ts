/**
 * ช่องกรอกที่ร้านตั้งเองรายเกม
 *
 * ปกติช่องกรอกของลูกค้ามาจากผู้ให้บริการโดยอัตโนมัติ แต่บางเจ้าไม่ได้บอกมา
 * (24BUYM ไม่บอกเลย ส่วน JCR ต้องไปอ่านจากแบบฟอร์ม ซึ่งอาจอ่านไม่ได้ทุกเกม)
 * ตารางนี้ให้ร้านพิมพ์เองได้ว่าจะให้ลูกค้ากรอกอะไรบ้าง เฉพาะเกมนั้น ๆ
 *
 * ⚠️ กฎเดียวที่ห้ามพลาด: "ชื่อช่อง" ต้องตรงกับที่ผู้ให้บริการกำหนดเป๊ะ
 * เพราะค่านี้ถูกส่งกลับไปให้เขาตรง ๆ ตอนสั่งซื้อ พิมพ์ผิดตัวเดียว = ออเดอร์ถูกปฏิเสธ
 * หรือแย่กว่านั้นคือเติมเข้าผิดเซิร์ฟเวอร์ซึ่งเอาเงินคืนไม่ได้
 */

export type CustomField = {
  key: string
  label: string
  options?: Array<{ value: string; label: string }>
}

/** ชื่อช่องรับได้เฉพาะอักษรอังกฤษ ตัวเลข และ _ . - ตามที่ผู้ให้บริการใช้กัน */
const KEY_PATTERN = /^[A-Za-z0-9_.-]+$/

export const FIELD_SPEC_EXAMPLE = `roleid | Role ID
server | Server | 1001=Talking Island, 1002=Gludio`

/**
 * แปลงข้อความที่ร้านพิมพ์เป็นรายการช่องกรอก
 * รูปแบบต่อหนึ่งบรรทัด: `ชื่อช่อง | ป้ายที่ลูกค้าเห็น | ตัวเลือก`
 * ตัวเลือกเขียนเป็น `ค่า=ป้าย` คั่นด้วยจุลภาค (ไม่มี = ก็ได้ จะใช้ค่านั้นเป็นป้ายเอง)
 */
export function parseFieldSpecText(text: string): { fields: CustomField[]; error: string | null } {
  const fields: CustomField[] = []
  const seen = new Set<string>()

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'))

  for (const line of lines) {
    const [rawKey = '', rawLabel = '', rawOptions = ''] = line.split('|').map((p) => p.trim())

    if (!rawKey) return { fields: [], error: `บรรทัด "${line}" ไม่มีชื่อช่อง` }
    if (!KEY_PATTERN.test(rawKey)) {
      return {
        fields: [],
        error: `ชื่อช่อง "${rawKey}" ใช้ไม่ได้ — ใช้ได้เฉพาะ a-z A-Z 0-9 และ _ . - (ต้องตรงกับที่ผู้ให้บริการกำหนด)`,
      }
    }
    if (seen.has(rawKey)) return { fields: [], error: `ชื่อช่อง "${rawKey}" ซ้ำกัน` }
    seen.add(rawKey)

    const options = rawOptions
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean)
      .map((o) => {
        const at = o.indexOf('=')
        if (at < 0) return { value: o, label: o }
        return { value: o.slice(0, at).trim(), label: o.slice(at + 1).trim() || o.slice(0, at).trim() }
      })
      .filter((o) => o.value !== '')

    fields.push({
      key: rawKey,
      label: rawLabel || rawKey,
      options: options.length > 0 ? options : undefined,
    })
  }

  if (fields.length > 12) {
    return { fields: [], error: 'กำหนดได้ไม่เกิน 12 ช่องต่อเกม' }
  }
  return { fields, error: null }
}

/** แปลงกลับเป็นข้อความ เพื่อเอาไปแสดงในช่องแก้ไข */
export function fieldSpecToText(fields: CustomField[] | null | undefined): string {
  if (!fields || fields.length === 0) return ''
  return fields
    .map((f) => {
      const parts = [f.key, f.label || f.key]
      if (f.options && f.options.length > 0) {
        parts.push(f.options.map((o) => (o.label && o.label !== o.value ? `${o.value}=${o.label}` : o.value)).join(', '))
      }
      return parts.join(' | ')
    })
    .join('\n')
}
