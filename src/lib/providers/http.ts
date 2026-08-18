import 'server-only'
import { ProviderError } from './types'

/**
 * ของกลางสำหรับคุมจังหวะการยิง API ของผู้ให้บริการทุกเจ้า
 *
 * ผู้ให้บริการทุกรายกันการยิงถี่ไว้หมด (rate limit) แต่กันคนละแบบและบอกคนละอย่าง
 * ถ้าปล่อยให้แต่ละตัวเชื่อมจัดการเอง จะได้พฤติกรรมไม่เหมือนกันและพลาดเหมือน ๆ กันทุกที่
 * ไฟล์นี้จึงรวมสามเรื่องไว้ที่เดียว:
 *   ① เว้นจังหวะตั้งแต่แรก ไม่ยิงรัวแล้วค่อยแก้ตอนโดนกัน
 *   ② โดนกันเมื่อไหร่ เชื่อเวลาที่ปลายทางบอกมา (Retry-After) แทนการเดาเอง
 *   ③ ให้ทุกเส้นของเจ้านั้นพักพร้อมกัน ไม่ใช่พักแค่เส้นที่โดน
 *
 * ⚠️ ข้อจำกัดที่ต้องรู้: Vercel รันหลายอินสแตนซ์พร้อมกัน ตัวคุมจังหวะนี้คุมได้เฉพาะ
 * ในอินสแตนซ์ของตัวเอง จึงเป็นแค่ "ลดโอกาสโดนกัน" ไม่ใช่ "กันได้ 100%"
 * ด่านจริงยังต้องเป็นการลองใหม่เมื่อโดนกันอยู่ดี
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** พักนานสุดเท่านี้ต่อครั้ง — ปลายทางบางเจ้าสั่งพักเป็นนาที ซึ่งรอไม่ไหวในคำขอเดียว */
const MAX_PAUSE_MS = 30_000

/** หมดเวลาที่ตั้งไว้สำหรับงานชุดนี้ — ไม่ใช่ความผิดพลาดของปลายทาง */
export class OutOfTime extends Error {
  constructor(message = 'หมดเวลาที่ตั้งไว้สำหรับรอบนี้') {
    super(message)
  }
}

/** อ่าน Retry-After ที่ปลายทางส่งมา รองรับทั้งแบบจำนวนวินาทีและแบบวันที่ */
export function retryAfterMs(header: string | null | undefined): number | null {
  if (!header) return null
  const seconds = Number(header.trim())
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const at = Date.parse(header)
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null
}

/**
 * ตัวคุมจังหวะ — จองคิวเวลายิงไว้ล่วงหน้าทีละคน
 * ทุกเส้นที่ใช้ตัวเดียวกันจะเรียงคิวกันเอง ไม่มีทางยิงพร้อมกันเป็นกระจุก
 */
export class Pacer {
  private nextAt = 0
  constructor(private readonly gap: number) {}

  /**
   * จองคิวยิงครั้งถัดไป แล้วรอจนถึงคิวของตัวเอง
   * @param deadline เวลาที่งานชุดนี้ต้องจบ (ถ้ามี) — คิวที่เลยเวลานี้จะไม่รอ
   * @returns false = เลยเวลาที่มีแล้ว ให้เลิกรอบนี้ อย่ารอต่อ
   *          (สำคัญมาก ถ้านอนรอจนฟังก์ชันถูกตัด งานที่ทำมาทั้งหมดจะหายไปด้วย)
   */
  async take(deadline?: number): Promise<boolean> {
    const now = Date.now()
    const at = Math.max(now, this.nextAt)
    if (deadline !== undefined && at >= deadline) return false
    this.nextAt = at + this.gap
    if (at > now) await sleep(at - now)
    return true
  }

  /** ปลายทางสั่งให้พัก — เลื่อนคิวของทุกเส้นที่ใช้ตัวนี้ออกไปพร้อมกัน */
  pause(ms: number) {
    this.nextAt = Math.max(this.nextAt, Date.now() + Math.min(ms, MAX_PAUSE_MS))
  }
}

/**
 * ตัวคุมจังหวะประจำผู้ให้บริการแต่ละราย ใช้ร่วมกันทั้งอินสแตนซ์
 * ต้องเป็นตัวเดียวกันทั้งตอนดึงรายการและตอนสั่งออเดอร์ ไม่งั้นสองงานนี้จะไปแย่งโควตากันเอง
 */
const pacers = new Map<string, Pacer>()

export function pacerFor(key: string, gapMs: number): Pacer {
  const found = pacers.get(key)
  if (found) return found
  const created = new Pacer(gapMs)
  pacers.set(key, created)
  return created
}

/** อ่านว่าข้อผิดพลาดนี้ลองใหม่ได้ไหม และปลายทางขอให้รอนานเท่าไร */
function retryInfo(err: unknown): { retryable: boolean; waitMs: number | null } {
  if (err instanceof ProviderError) return { retryable: err.retryable, waitMs: err.retryAfterMs }
  // ตัวเชื่อมที่ใช้ error ของตัวเอง (เช่น 24BUYM) แปะสองค่านี้ไว้ให้เหมือนกัน
  const like = err as { retryable?: unknown; retryAfterMs?: unknown }
  return {
    retryable: like?.retryable === true,
    waitMs: typeof like?.retryAfterMs === 'number' ? like.retryAfterMs : null,
  }
}

/**
 * ยิงหนึ่งครั้งผ่านตัวคุมจังหวะ พร้อมลองใหม่เมื่อโดนปลายทางกัน
 *
 * @param opts.deadline  เวลาที่งานชุดนี้ต้องจบ — ใช้กับงานยาวอย่างการดึงรายการทั้งร้าน
 * @param opts.maxWaitMs รอได้นานสุดเท่าไรต่อครั้ง — ใช้กับงานที่มีคนรออยู่หน้าจอ
 *                       (ตอนลูกค้ากดซื้อ ให้ยอมแพ้เร็ว ๆ แล้วเข้าคิวส่งใหม่ ดีกว่าค้างหน้าเว็บ)
 */
export async function limited<T>(
  pacer: Pacer,
  run: () => Promise<T>,
  opts: { attempts?: number; deadline?: number; maxWaitMs?: number } = {}
): Promise<T> {
  const attempts = opts.attempts ?? 3
  for (let attempt = 1; ; attempt++) {
    if (!(await pacer.take(opts.deadline))) throw new OutOfTime()
    try {
      return await run()
    } catch (err) {
      const { retryable, waitMs } = retryInfo(err)
      if (!retryable) throw err

      // ปลายทางบอกเวลามาก็เชื่อตามนั้น ไม่ได้บอกก็ถอยห่างขึ้นเรื่อย ๆ
      const wait = waitMs ?? 400 * attempt
      // พักทั้งเจ้า ไม่ใช่แค่เส้นนี้ — ไม่งั้นเส้นอื่นจะยิงต่อจนโดนกันตามไปด้วย
      pacer.pause(wait)

      if (attempt >= attempts) throw err
      if (opts.maxWaitMs !== undefined && wait > opts.maxWaitMs) throw err
      if (opts.deadline !== undefined && Date.now() + wait >= opts.deadline) throw new OutOfTime()
    }
  }
}

/** จังหวะยิงเริ่มต้นของงานที่มีคนรออยู่หน้าจอ — รอนานกว่านี้ควรยอมแพ้แล้วเข้าคิวใหม่ */
export const INTERACTIVE_MAX_WAIT_MS = 2_000
