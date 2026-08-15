import { NextResponse } from 'next/server'
import { q } from '@/lib/db'
import { publicSupabaseConfig } from '@/lib/supabase'
import { todayISO } from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * หน้าตรวจสุขภาพระบบ — ใช้หาว่าช้าตรงไหน
 * คืนแค่ตัวเลขเวลาและชื่อรีเจิน ไม่มีคีย์หรือข้อมูลลูกค้าใด ๆ ออกไป
 */
async function timed<T>(fn: () => Promise<T>) {
  const started = Date.now()
  try {
    await fn()
    return { ms: Date.now() - started, ok: true as const }
  } catch (err) {
    return {
      ms: Date.now() - started,
      ok: false as const,
      error: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
    }
  }
}

/** ดึงเฉพาะชื่อรีเจินจาก host ของฐานข้อมูล เช่น aws-0-us-east-1.pooler.supabase.com -> us-east-1 */
function dbRegion() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL
  if (!url) return null
  const host = url.match(/@([^:/?]+)/)?.[1] ?? ''
  return host.match(/aws-\d+-([a-z]+-[a-z]+-\d+)/)?.[1] ?? host.split('.').slice(-3).join('.')
}

export async function GET() {
  const today = todayISO()

  const connect = await timed(() => q('select 1 as ok'))
  const simpleRead = await timed(() => q('select count(*)::int as n from profiles'))

  // ชุดเดียวกับที่หน้าแดชบอร์ดยิงพร้อมกัน
  const dashboard = await timed(() =>
    Promise.all([
      q(
        `select coalesce(sum(total) filter (where d = $1::date), 0)::float8 as t
           from (select total, (sold_at at time zone 'Asia/Bangkok')::date as d
                   from sales where status = 'paid') s`,
        [today]
      ),
      q(
        `select to_char(g.day, 'DD') as label, coalesce(sum(s.total), 0)::float8 as value
           from generate_series($1::date, ($1::date + interval '1 month' - interval '1 day'),
                                interval '1 day') as g(day)
           left join (select total, (sold_at at time zone 'Asia/Bangkok')::date as d
                        from sales where status = 'paid') s on s.d = g.day::date
          group by g.day order by g.day`,
        [`${today.slice(0, 7)}-01`]
      ),
      q('select count(*)::int as n from games'),
      q('select count(*)::int as n from products'),
      q('select count(*)::int as n from customers'),
      q('select count(*)::int as n from sales'),
      q('select count(*)::int as n from stock_movements'),
      q('select count(*)::int as n from expenses'),
    ])
  )

  let authMs: number | null = null
  let authError: string | null = null
  try {
    const { url, key } = publicSupabaseConfig()
    const started = Date.now()
    const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } })
    authMs = Date.now() - started
    if (!res.ok) authError = `HTTP ${res.status}`
  } catch (err) {
    authError = err instanceof Error ? err.message.slice(0, 200) : 'ไม่ทราบสาเหตุ'
  }

  return NextResponse.json(
    {
      vercelRegion: process.env.VERCEL_REGION ?? 'local',
      databaseRegion: dbRegion(),
      timings: {
        dbConnectFirstQuery: connect,
        dbSimpleRead: simpleRead,
        dashboardQueries: dashboard,
        supabaseAuthPing: { ms: authMs, error: authError },
      },
    },
    { headers: { 'cache-control': 'no-store' } }
  )
}
