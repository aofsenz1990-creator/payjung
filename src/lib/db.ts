import 'server-only'
import postgres from 'postgres'
import { SCHEMA_STATEMENTS } from './schema'

export class ConfigError extends Error {}

let client: postgres.Sql | null = null

/** ข้อมูลปลายทางของฐานข้อมูล (ไม่มีรหัสผ่าน) ใช้ตรวจว่าต่อผ่าน pooler ถูกตัวไหม */
export function dbTarget() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL
  if (!url) return null
  const m = url.match(/@([^:/?]+)(?::(\d+))?/)
  const host = m?.[1] ?? ''
  const port = m?.[2] ?? '5432'
  return {
    host,
    port,
    region: host.match(/aws-\d+-([a-z]+-[a-z]+-\d+)/)?.[1] ?? null,
    // 6543 = transaction pooler (ที่ควรใช้บน serverless), 5432 = session/direct
    mode: port === '6543' ? 'transaction-pooler' : port === '5432' ? 'session-or-direct' : port,
    pooled: /pooler\.supabase\.com/.test(host),
  }
}

function getClient() {
  if (client) return client
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL
  if (!url) {
    throw new ConfigError(
      'ยังไม่ได้ตั้งค่า DATABASE_URL — คัดลอก Connection string (Transaction pooler) จาก Supabase > Project Settings > Database มาใส่ใน Environment Variables ของ Vercel'
    )
  }
  client = postgres(url, {
    // Supabase Transaction pooler ไม่รองรับ prepared statement
    prepare: false,
    // ปกติ postgres.js จะยิงถามตารางชนิดข้อมูลตอนต่อครั้งแรก ซึ่งเสียเวลาไปฟรี ๆ หนึ่งรอบ
    fetch_types: false,
    // บน serverless หนึ่ง instance รับทีละรีเควสต์อยู่แล้ว เปิดคอนเนกชันเดียวพอ
    // ถ้าเปิดหลายอันคูณจำนวน instance จะกินโควตาของ Supabase จนเต็มแล้วค้างทั้งระบบ
    max: 1,
    idle_timeout: 10,
    connect_timeout: 10,
    max_lifetime: 60 * 5,
  })
  return client
}

/**
 * ต่อคิวให้ query วิ่งทีละคำสั่งต่อหนึ่ง instance
 *
 * postgres.js จะ "pipeline" คำสั่งที่ยิงพร้อมกันลงคอนเนกชันเดียว ซึ่ง PgBouncer
 * ของ Supabase ในโหมด transaction รับไม่ได้ ผลคือค้างยาวจนหมดเวลา
 * (วัดจริงแล้ว: ยิงทีละคำสั่ง 8 คำสั่งใช้ 120ms แต่ยิงพร้อมกันค้างเกิน 12 วินาที)
 *
 * แต่ละคำสั่งใช้เวลา 1-3 ms อยู่แล้ว ต่อคิวจึงแทบไม่ต่างและได้ความนิ่งกลับมา
 */
let queue: Promise<void> = Promise.resolve()

function serialize<T>(run: () => Promise<T>): Promise<T> {
  const result = queue.then(run)
  queue = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

/**
 * กันไม่ให้ค้างยาว ถ้าฐานข้อมูลไม่ตอบให้ขึ้น error ใน 12 วินาที จะได้รู้ว่าพังที่ตรงไหน
 *
 * ต้องครอบ "ตัวคำสั่ง" ที่อยู่ในคิว ไม่ใช่ครอบ "การรอคิว" จากข้างนอก
 * ถ้าครอบจากข้างนอก คนเรียกจะได้ error ตามกำหนดก็จริง แต่คิวไม่ขยับ เพราะคิวรอ
 * ให้คำสั่งเดิมจบก่อน คำสั่งที่ค้างตัวเดียวจึงล็อกทุกคำสั่งที่ตามมาไว้ตลอดกาล
 * อาการที่เห็นคือกดบันทึกแล้วหมุนค้าง ต้องรีเฟรชหน้าถึงจะกลับมาใช้ได้
 */
function withTimeout<T>(promise: Promise<T>, ms = 12_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`ฐานข้อมูลไม่ตอบภายใน ${ms / 1000} วินาที`)),
      ms
    )
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

/**
 * เวอร์ชันของโครงสร้างฐานข้อมูล
 * แก้ schema.ts เมื่อไหร่ให้เปลี่ยนเลขนี้ด้วย ระบบจะรัน DDL ชุดใหม่ให้อัตโนมัติครั้งเดียว
 */
const SCHEMA_VERSION = '2026-08-16.7'

// สร้างตารางครั้งแรกที่ instance ถูกเรียก แล้วแคชไว้ (CREATE ... IF NOT EXISTS จึงรันซ้ำได้)
let schemaReady: Promise<void> | null = null

function ensureSchema() {
  if (!schemaReady) {
    // ต้องมีเพดานเวลาเสมอ เพราะ q() ทุกตัวรอตรงนี้ก่อน
    // ถ้าตรงนี้ค้าง ทุกคำสั่งของ instance นี้ค้างตามทั้งหมดตลอดกาล
    // อาการที่เห็นคือกดบันทึกแล้วปุ่มหมุนค้างไม่มีวันจบ และตัวจับเวลาของ q()
    // ช่วยไม่ได้เพราะค้างตั้งแต่ก่อนถึงคิวคำสั่ง
    schemaReady = withTimeout(
      (async () => {
        const sql = getClient()

        // เช็กก่อนด้วยคำสั่งเดียวว่าโครงสร้างเป็นเวอร์ชันล่าสุดแล้วหรือยัง
        // ถ้าครบก็ข้ามการสร้างไปเลย ไม่ต้องยิง DDL ยาว ๆ ทุกครั้งที่ instance เย็น
        try {
          const rows = await sql.unsafe<{ value: string | null }[]>(
            `select value from site_settings where key = 'schema_version'`
          )
          if (rows[0]?.value === SCHEMA_VERSION) return
        } catch {
          // ยังไม่มีตาราง site_settings = ฐานข้อมูลใหม่เอี่ยม ให้สร้างทั้งชุด
        }

        // รวมทุก statement ยิงรอบเดียวแบบ simple query (เป็นทรานแซกชันเดียว)
        //
        // lock_timeout สำคัญมาก: alter table ต้องขอล็อกระดับสูงสุดของตาราง
        // ถ้ามีคนกำลังอ่านตารางนั้นอยู่ (อีก instance เรนเดอร์หน้า หรือเสียงแจ้งเตือน
        // ที่ยิงทุก 10 วินาที) มันจะรอไปเรื่อย ๆ แบบไม่มีกำหนด และระหว่างที่รอ
        // ยังไปขวางคำสั่งอื่นที่แตะตารางเดียวกันต่อเป็นทอด ๆ
        // ตั้งเพดานไว้ให้ล้มเร็ว ๆ แล้วลองใหม่รอบหน้าดีกว่าค้างทั้งระบบ
        await sql
          .unsafe(
            `set local lock_timeout = '5s';\n` +
              `set local statement_timeout = '30s';\n` +
              SCHEMA_STATEMENTS.join(';\n')
          )
          .simple()
        await sql.unsafe(
          `insert into site_settings (key, value) values ('schema_version', $1)
           on conflict (key) do update set value = excluded.value`,
          [SCHEMA_VERSION]
        )
      })(),
      40_000
    ).catch((err) => {
      schemaReady = null // ให้ลองใหม่ได้ในรีเควสต์ถัดไป
      const message = err instanceof Error ? err.message : String(err)
      if (/lock|timeout|ไม่ตอบ/i.test(message)) {
        throw new Error(
          'ระบบกำลังปรับโครงสร้างฐานข้อมูลอยู่ (มีการอัปเดตเวอร์ชันใหม่) ' +
            'รอสักครู่แล้วกดบันทึกอีกครั้ง — ข้อมูลที่กรอกไว้ยังอยู่'
        )
      }
      throw err
    })
  }
  return schemaReady
}

/** ยิง SQL พร้อม parameter ($1, $2, ...) และคืนค่าเป็น array ของแถว */
export async function q<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  await ensureSchema()
  const sql = getClient()
  const rows = await serialize(() => withTimeout(sql.unsafe(text, params as never[])))
  return rows as unknown as T[]
}

/** ยิง SQL แล้วเอาแถวแรก (หรือ null) */
export async function q1<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await q<T>(text, params)
  return rows[0] ?? null
}

// หมายเหตุ: การบันทึกขาย/ยกเลิกขาย ที่ต้องแตะหลายตารางพร้อมกัน เขียนเป็น statement เดียว
// ด้วย CTE (with ... ) เพราะ statement เดียวของ Postgres เป็นทรานแซกชันในตัวอยู่แล้ว
