import 'server-only'
import { headers } from 'next/headers'
import { q1 } from './db'

/**
 * ตัวกันยิงรัว ๆ (rate limit)
 *
 * เก็บตัวนับไว้ในฐานข้อมูล ไม่ใช่ในหน่วยความจำ เพราะ Vercel รันหลาย instance พร้อมกัน
 * ถ้านับในหน่วยความจำ คนยิงแค่สลับ instance ก็ผ่านแล้ว
 *
 * ทุกตัวนับ "ปล่อยผ่าน" ถ้าฐานข้อมูลมีปัญหา — ตัวกันสแปมต้องไม่ทำให้ลูกค้าซื้อของไม่ได้
 */

/** เลขไอพีของคนที่ยิงเข้ามา อ่านจาก header ที่ Vercel ใส่ให้ */
export async function clientIp(): Promise<string> {
  const h = await headers()
  // x-forwarded-for เป็นรายการต่อกันด้วยจุลภาค ตัวแรกคือผู้ใช้จริง
  const forwarded = h.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || h.get('x-real-ip') || 'unknown'
}

/** ล้างตัวนับเก่าทิ้งเป็นระยะ ไม่ให้ตารางโตขึ้นเรื่อย ๆ (ทำแบบสุ่มจะได้ไม่ต้องมี cron) */
async function sweep() {
  if (Math.random() > 0.02) return
  try {
    await q1(`delete from rate_limits where window_start < now() - interval '1 day'`)
  } catch {
    // ล้างไม่ได้ก็ไม่เป็นไร รอบหน้าค่อยลองใหม่
  }
}

/**
 * นับหนึ่งครั้งในถัง `bucket` แล้วบอกว่าเกินโควตาหรือยัง
 * @returns true = เกินโควตา ให้ปฏิเสธ
 */
export async function tooMany(bucket: string, limit: number, seconds: number): Promise<boolean> {
  try {
    // นับและรีเซ็ตหน้าต่างเวลาในคำสั่งเดียว จะได้ไม่มีช่องให้ยิงแทรกระหว่างอ่านกับเขียน
    const row = await q1<{ hits: number }>(
      `insert into rate_limits as r (bucket, hits, window_start)
       values ($1, 1, now())
       on conflict (bucket) do update
          set hits = case when r.window_start < now() - make_interval(secs => $2::int)
                          then 1 else r.hits + 1 end,
              window_start = case when r.window_start < now() - make_interval(secs => $2::int)
                                  then now() else r.window_start end
       returning hits`,
      [bucket.slice(0, 200), seconds]
    )
    void sweep()
    return (row?.hits ?? 0) > limit
  } catch {
    // ฐานข้อมูลมีปัญหา — ปล่อยผ่าน ดีกว่าปิดร้านทั้งร้าน
    return false
  }
}

/** นับตามเลขไอพีของผู้ใช้ */
export async function tooManyFromIp(action: string, limit: number, seconds: number) {
  return tooMany(`${action}:ip:${await clientIp()}`, limit, seconds)
}

/** ข้อความมาตรฐานตอนโดนกัน — ไม่บอกรายละเอียดว่านับยังไง */
export const TOO_MANY_MESSAGE = 'ลองบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่'
