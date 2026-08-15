import 'server-only'
import { safeMonth } from './format'

export type HistoryFilters = {
  month: string // 'all' หรือ YYYY-MM
  from: string | null // YYYY-MM-DD
  to: string | null
  gameId: number | null
  customerId: number | null
  status: string // 'all' | paid | pending | cancelled
  keyword: string
}

export function parseFilters(sp: Record<string, string | string[] | undefined>): HistoryFilters {
  const one = (k: string) => {
    const v = sp[k]
    return typeof v === 'string' ? v.trim() : ''
  }
  const monthRaw = one('month')
  const date = (k: string) => (/^\d{4}-\d{2}-\d{2}$/.test(one(k)) ? one(k) : null)
  const id = (k: string) => {
    const n = Number.parseInt(one(k), 10)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  return {
    month: monthRaw === 'all' ? 'all' : safeMonth(monthRaw || undefined),
    from: date('from'),
    to: date('to'),
    gameId: id('game'),
    customerId: id('customer'),
    status: ['paid', 'pending', 'cancelled'].includes(one('status')) ? one('status') : 'all',
    keyword: one('q'),
  }
}

/** สร้างเงื่อนไข WHERE + พารามิเตอร์ ให้ใช้ซ้ำได้ทั้งหน้ารายการและไฟล์ CSV */
export function buildWhere(f: HistoryFilters) {
  const clauses: string[] = []
  const params: unknown[] = []
  const day = `(s.sold_at at time zone 'Asia/Bangkok')::date`

  if (f.from) {
    params.push(f.from)
    clauses.push(`${day} >= $${params.length}::date`)
  }
  if (f.to) {
    params.push(f.to)
    clauses.push(`${day} <= $${params.length}::date`)
  }
  // ถ้าไม่ได้ระบุช่วงวันที่เอง ให้ใช้เดือนที่เลือก
  if (!f.from && !f.to && f.month !== 'all') {
    params.push(`${f.month}-01`)
    clauses.push(`${day} >= $${params.length}::date and ${day} < $${params.length}::date + interval '1 month'`)
  }
  if (f.gameId) {
    params.push(f.gameId)
    clauses.push(`s.game_id = $${params.length}`)
  }
  if (f.customerId) {
    params.push(f.customerId)
    clauses.push(`s.customer_id = $${params.length}`)
  }
  if (f.status !== 'all') {
    params.push(f.status)
    clauses.push(`s.status = $${params.length}`)
  }
  if (f.keyword) {
    params.push(`%${f.keyword}%`)
    const i = params.length
    clauses.push(
      `(s.code ilike $${i} or s.item_name ilike $${i} or s.game_account ilike $${i}
        or s.note ilike $${i} or c.name ilike $${i})`
    )
  }

  return { where: clauses.length ? `where ${clauses.join(' and ')}` : '', params }
}

export const HISTORY_JOINS = `
  from sales s
  left join games g on g.id = s.game_id
  left join customers c on c.id = s.customer_id
  left join profiles u on u.id = s.created_by
`

export function filtersToQuery(f: HistoryFilters, extra: Record<string, string> = {}) {
  const sp = new URLSearchParams()
  if (f.month !== 'all') sp.set('month', f.month)
  else sp.set('month', 'all')
  if (f.from) sp.set('from', f.from)
  if (f.to) sp.set('to', f.to)
  if (f.gameId) sp.set('game', String(f.gameId))
  if (f.customerId) sp.set('customer', String(f.customerId))
  if (f.status !== 'all') sp.set('status', f.status)
  if (f.keyword) sp.set('q', f.keyword)
  for (const [k, v] of Object.entries(extra)) sp.set(k, v)
  return sp.toString()
}
