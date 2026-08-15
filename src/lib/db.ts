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

/** กันไม่ให้ค้างยาว ถ้าฐานข้อมูลไม่ตอบให้ขึ้น error ใน 12 วินาที จะได้รู้ว่าพังที่ตรงไหน */
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
 * คอลัมน์ที่เพิ่มล่าสุด ใช้เป็นหมุดบอกว่าโครงสร้างเป็นเวอร์ชันปัจจุบันแล้วหรือยัง
 * เวลาเพิ่มคอลัมน์ใหม่ใน schema.ts ให้อัปเดตตรงนี้ด้วย ระบบจะได้รู้ว่าต้องรัน DDL ซ้ำ
 */
const SCHEMA_MARKER = { table: 'products', column: 'provider_game_id' }

// ตารางที่ต้องมีครบ ถ้าเพิ่มตารางใหม่ใน schema.ts ต้องเติมชื่อที่นี่ด้วย
const EXPECTED_TABLES = [
  'profiles',
  'games',
  'products',
  'customers',
  'sales',
  'stock_movements',
  'expenses',
  'api_providers',
  'credit_transactions',
  'news',
  'site_settings',
  'provider_catalog',
]

// สร้างตารางครั้งแรกที่ instance ถูกเรียก แล้วแคชไว้ (CREATE ... IF NOT EXISTS จึงรันซ้ำได้)
let schemaReady: Promise<void> | null = null

function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getClient()

      // เช็กก่อนด้วยคำสั่งเดียวว่าตารางครบแล้วหรือยัง
      // ถ้าครบก็ข้ามการสร้างไปเลย ไม่ต้องยิง DDL ยาว ๆ ทุกครั้งที่ instance เย็น
      const list = EXPECTED_TABLES.map((t) => `'${t}'`).join(', ')
      const [{ tables, marker }] = await sql.unsafe<{ tables: number; marker: number }[]>(
        `select
           (select count(*)::int from pg_tables
             where schemaname = 'public' and tablename in (${list})) as tables,
           (select count(*)::int from information_schema.columns
             where table_schema = 'public' and table_name = '${SCHEMA_MARKER.table}'
               and column_name = '${SCHEMA_MARKER.column}') as marker`
      )
      if (tables >= EXPECTED_TABLES.length && marker === 1) return

      // ครั้งแรกเท่านั้น — รวมทุก statement ยิงรอบเดียวแบบ simple query
      await sql.unsafe(SCHEMA_STATEMENTS.join(';\n')).simple()
    })().catch((err) => {
      schemaReady = null // ให้ลองใหม่ได้ในรีเควสต์ถัดไป
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
  const rows = await withTimeout(serialize(() => sql.unsafe(text, params as never[])))
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
