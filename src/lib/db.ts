import 'server-only'
import postgres from 'postgres'
import { SCHEMA_STATEMENTS } from './schema'

export class ConfigError extends Error {}

let client: postgres.Sql | null = null

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
    // เชื่อมต่อน้อย ๆ เพราะรันบน serverless ที่มีหลาย instance
    max: 3,
    idle_timeout: 20,
    connect_timeout: 15,
  })
  return client
}

// สร้างตารางครั้งแรกที่ instance ถูกเรียก แล้วแคชไว้ (CREATE ... IF NOT EXISTS จึงรันซ้ำได้)
let schemaReady: Promise<void> | null = null

function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getClient()
      for (const statement of SCHEMA_STATEMENTS) {
        await sql.unsafe(statement)
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
  const rows = await sql.unsafe(text, params as never[])
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
