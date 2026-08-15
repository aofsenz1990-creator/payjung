export const TZ = 'Asia/Bangkok'

const baht = new Intl.NumberFormat('th-TH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const bahtShort = new Intl.NumberFormat('th-TH', {
  maximumFractionDigits: 0,
})

export function money(value: number | string | null | undefined) {
  const n = Number(value ?? 0)
  return baht.format(Number.isFinite(n) ? n : 0)
}

export function moneyShort(value: number | string | null | undefined) {
  const n = Number(value ?? 0)
  return bahtShort.format(Number.isFinite(n) ? n : 0)
}

export function num(value: number | string | null | undefined) {
  const n = Number(value ?? 0)
  return new Intl.NumberFormat('th-TH').format(Number.isFinite(n) ? n : 0)
}

/** 15 ส.ค. 2569 14:32 */
export function dateTime(value: string | Date | null | undefined) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: TZ,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

/** 15 ส.ค. 2569 */
export function dateOnly(value: string | Date | null | undefined) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: TZ,
    dateStyle: 'medium',
  }).format(new Date(value))
}

/** 14:32 */
export function timeOnly(value: string | Date | null | undefined) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

/** "2026-08" -> "สิงหาคม 2569" */
export function monthLabel(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return ym
  return new Intl.DateTimeFormat('th-TH', { timeZone: TZ, month: 'long', year: 'numeric' }).format(
    new Date(Date.UTC(y, m - 1, 15))
  )
}

/** วันนี้ตามเวลาไทย ในรูปแบบ YYYY-MM-DD */
export function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
}

/** เดือนนี้ตามเวลาไทย ในรูปแบบ YYYY-MM */
export function currentMonth() {
  return todayISO().slice(0, 7)
}

/** รายชื่อเดือนย้อนหลัง n เดือน นับจากเดือนที่ให้มา (YYYY-MM) */
export function recentMonths(from: string, n = 18) {
  const [y, m] = from.split('-').map(Number)
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

/** ตรวจว่าเป็นรูปแบบ YYYY-MM ที่ใช้ได้ ถ้าไม่ใช่คืนเดือนปัจจุบัน */
export function safeMonth(value: string | undefined | null) {
  return value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : currentMonth()
}

/** ค่าสำหรับ <input type="datetime-local"> ของเวลาปัจจุบัน (เวลาไทย) */
export function nowLocalInput() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

/**
 * แปลงค่าจาก <input type="datetime-local"> (ผู้ใช้กรอกเป็นเวลาไทย) ให้เป็น ISO string แบบ UTC
 * ประเทศไทยเป็น UTC+7 คงที่ตลอดปี ไม่มี DST จึงลบ 7 ชั่วโมงตรง ๆ ได้
 */
export function localInputToISO(value: string | null | undefined) {
  if (!value) return null
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!m) return null
  const [, y, mo, d, h, mi] = m
  const utcMs = Date.UTC(+y, +mo - 1, +d, +h, +mi) - 7 * 60 * 60 * 1000
  return new Date(utcMs).toISOString()
}
