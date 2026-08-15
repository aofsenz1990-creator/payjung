import { NextResponse, type NextRequest } from 'next/server'
import { dbTarget, q } from '@/lib/db'
import { publicSupabaseConfig } from '@/lib/supabase'
import { todayISO } from '@/lib/format'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

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

/** รหัสโปรเจกต์ Supabase ที่ใช้อยู่จริง อ่านจาก URL เช่น https://abcdefgh.supabase.co -> abcdefgh */
function supabaseProjectRef() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  return url?.match(/https:\/\/([a-z0-9]+)\.supabase\./)?.[1] ?? null
}

export async function GET(request: NextRequest) {
  const target = dbTarget()
  const ref = supabaseProjectRef()
  const base = {
    vercelRegion: process.env.VERCEL_REGION ?? 'local',
    supabaseProjectRef: ref,
    supabaseDashboard: ref ? `https://supabase.com/dashboard/project/${ref}` : null,
    database: target,
    envPresent: {
      DATABASE_URL: Boolean(process.env.DATABASE_URL),
      POSTGRES_URL: Boolean(process.env.POSTGRES_URL),
      SUPABASE_URL: Boolean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL),
      SUPABASE_SERVICE_ROLE_KEY: Boolean(
        process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
      ),
    },
  }

  const deep = request.nextUrl.searchParams.get('deep')

  // ค่าเริ่มต้นตอบทันทีโดยไม่แตะฐานข้อมูล จะได้ตรวจการตั้งค่าได้แม้ตอนฐานข้อมูลค้าง
  if (deep !== '1' && deep !== 'seq') {
    return NextResponse.json(
      { ...base, hint: 'เติม ?deep=1 (ยิงพร้อมกัน) หรือ ?deep=seq (วัดทีละคำสั่ง)' },
      { headers: { 'cache-control': 'no-store' } }
    )
  }

  const today = todayISO()
  const monthStart = `${today.slice(0, 7)}-01`

  const CASES: Array<[string, () => Promise<unknown>]> = [
    ['sumFilter', () =>
      q(`select coalesce(sum(total) filter (where d = $1::date), 0)::float8 as t
           from (select total, (sold_at at time zone 'Asia/Bangkok')::date as d
                   from sales where status = 'paid') s`, [today])],
    ['generateSeries', () =>
      q(`select to_char(g.day, 'DD') as label, coalesce(sum(s.total), 0)::float8 as value
           from generate_series($1::date, ($1::date + interval '1 month' - interval '1 day'),
                                interval '1 day') as g(day)
           left join (select total, (sold_at at time zone 'Asia/Bangkok')::date as d
                        from sales where status = 'paid') s on s.d = g.day::date
          group by g.day order by g.day`, [monthStart])],
    ['countGames', () => q('select count(*)::int as n from games')],
    ['countProducts', () => q('select count(*)::int as n from products')],
    ['countCustomers', () => q('select count(*)::int as n from customers')],
    ['countSales', () => q('select count(*)::int as n from sales')],
    ['countMovements', () => q('select count(*)::int as n from stock_movements')],
    ['countExpenses', () => q('select count(*)::int as n from expenses')],
  ]

  // โหมดวัดทีละคำสั่ง เพื่อหาว่าค้างที่คำสั่งไหน
  if (deep === 'seq') {
    const results: Record<string, unknown> = {}
    for (const [name, run] of CASES) results[name] = await timed(run)
    return NextResponse.json(
      { ...base, mode: 'sequential', results },
      { headers: { 'cache-control': 'no-store' } }
    )
  }

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
      ...base,
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
