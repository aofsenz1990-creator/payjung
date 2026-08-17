/** ตัวช่วยอ่านค่าจาก FormData ให้ได้ชนิดที่ถูกต้อง */

export function str(fd: FormData, key: string) {
  const v = fd.get(key)
  return typeof v === 'string' ? v.trim() : ''
}

export function optStr(fd: FormData, key: string) {
  const v = str(fd, key)
  return v === '' ? null : v
}

export function int(fd: FormData, key: string, fallback = 0) {
  const n = Number.parseInt(str(fd, key), 10)
  return Number.isFinite(n) ? n : fallback
}

export function optInt(fd: FormData, key: string) {
  const v = str(fd, key)
  if (v === '') return null
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) ? n : null
}

export function decimal(fd: FormData, key: string, fallback = 0) {
  const n = Number.parseFloat(str(fd, key).replace(/,/g, ''))
  return Number.isFinite(n) ? n : fallback
}

export function bool(fd: FormData, key: string) {
  const v = fd.get(key)
  return v === 'on' || v === 'true' || v === '1'
}

/** แปลง error จากฐานข้อมูลให้เป็นข้อความภาษาไทยที่อ่านรู้เรื่อง */
export function friendlyError(err: unknown, fallback = 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง') {
  const message = err instanceof Error ? err.message : String(err)
  if (/duplicate key|unique constraint/i.test(message)) {
    if (/games_name_uniq/.test(message)) return 'มีเกมชื่อนี้อยู่แล้ว'
    if (/profiles_pkey/.test(message)) return 'บัญชีนี้มีอยู่ในระบบแล้ว'
    return 'ข้อมูลนี้ซ้ำกับที่มีอยู่แล้ว'
  }
  if (/DATABASE_URL|SUPABASE/.test(message)) return message
  if (/violates foreign key/i.test(message)) return 'ลบไม่ได้ เพราะมีข้อมูลอื่นอ้างอิงรายการนี้อยู่'
  return `${fallback} (${message})`
}

/**
 * แบบเดียวกันแต่ใช้กับหน้าเว็บลูกค้า
 *
 * friendlyError จะพ่วงข้อความ error ดิบ ๆ ออกไปด้วยเพื่อให้พนักงานแก้ปัญหาได้
 * ซึ่งบอกชื่อตาราง/ชื่อคอลัมน์/โครงสร้างฐานข้อมูลออกไปด้วย
 * ฝั่งลูกค้าไม่ควรเห็นตรงนั้น เพราะเป็นแผนที่ชั้นดีให้คนที่คิดจะเจาะระบบ
 */
export function customerError(err: unknown, fallback = 'ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง') {
  const message = err instanceof Error ? err.message : String(err)
  if (/duplicate key|unique constraint/i.test(message)) return 'ข้อมูลนี้ซ้ำกับที่มีอยู่แล้ว'
  if (/ฐานข้อมูลไม่ตอบ|timeout/i.test(message)) {
    return 'ระบบตอบช้าผิดปกติ กรุณาลองใหม่อีกครั้ง'
  }
  return fallback
}
