import 'server-only'
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import { SCHEMA_STATEMENTS } from './schema'

export class ConfigError extends Error {}

let client: NeonQueryFunction<false, false> | null = null

function getClient() {
  if (client) return client
  const url =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.POSTGRES_URL_NON_POOLING
  if (!url) {
    throw new ConfigError(
      'ยังไม่ได้ตั้งค่า DATABASE_URL — ไปที่ Vercel > Storage > สร้าง Neon Postgres แล้ว redeploy อีกครั้ง'
    )
  }
  client = neon(url)
  return client
}

// สร้างตารางครั้งแรกที่ instance ถูกเรียก แล้วแคชไว้ (CREATE ... IF NOT EXISTS จึงรันซ้ำได้)
let schemaReady: Promise<void> | null = null

function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getClient()
      for (const statement of SCHEMA_STATEMENTS) {
        await sql.query(statement)
      }
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
  const rows = await sql.query(text, params as never[])
  return rows as T[]
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
