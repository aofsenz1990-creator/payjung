/**
 * ตัวช่วยอ่านค่าจากคอลัมน์ jsonb
 *
 * ค่าที่ได้กลับมาจากฐานข้อมูลอาจเป็นข้อความดิบหรือเป็นค่าที่แปลงมาแล้ว แล้วแต่จังหวะ
 * (โปรเจกต์นี้ตั้ง fetch_types = false เพื่อความเร็ว ทำให้บางครั้งได้ข้อความกลับมา)
 *
 * ถ้าเอาไปใช้ตรง ๆ โดยไม่ผ่านตรงนี้จะเจอปัญหาที่หาสาเหตุยาก เพราะข้อความก็มี .length
 * เหมือน array เงื่อนไขอย่าง `if (x?.length)` จึงผ่าน แต่พอ .map ก็พังทันที
 * อ่าน jsonb ที่ไหนให้ผ่านสองฟังก์ชันนี้เสมอ
 */

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** อ่านเป็น array — คืน null ถ้าไม่ใช่ array หรือว่างเปล่า */
export function jsonArray<T>(value: unknown): T[] | null {
  const parsed = typeof value === 'string' ? safeParse(value) : value
  return Array.isArray(parsed) && parsed.length > 0 ? (parsed as T[]) : null
}

/** อ่านเป็นคู่ คีย์-ข้อความ — คืน null ถ้าไม่ใช่ออบเจกต์หรือว่างเปล่า */
export function jsonRecord(value: unknown): Record<string, string> | null {
  const parsed = typeof value === 'string' ? safeParse(value) : value
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  const out: Record<string, string> = {}
  for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
    if (val !== null && val !== undefined) out[key] = String(val)
  }
  return Object.keys(out).length > 0 ? out : null
}
