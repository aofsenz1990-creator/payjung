import 'server-only'
import { q } from './db'
import { providerBalance, type ProviderRow } from './dispatch'
import { notifyLine } from './line'

/**
 * สรุปยอดขายประจำวัน ส่งเข้า LINE
 *
 * ตั้งใจให้อ่านจบในหน้าจอเดียวบนมือถือ — เจ้าของร้านเปิดดูตอนกลางคืนแล้วรู้ทันทีว่า
 * วันนี้ขายอะไรไปเท่าไหร่ จ่ายต้นทุนให้เจ้าไหนเท่าไหร่ และเงินที่ค้างอยู่กับผู้ให้บริการเหลือเท่าไหร่
 */

const THAI_MONTHS = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
]

function thaiDateLabel(d: Date) {
  return `${d.getDate()} ${THAI_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`
}

/**
 * หา "วันที่จะสรุป" ตามเวลาไทย
 *
 * ตัวสรุปทำงานตอนเที่ยงคืน ซึ่งตอนนั้นวันใหม่เพิ่งเริ่มไปไม่กี่วินาที
 * ถ้าสรุป "วันนี้" ตรง ๆ จะได้ข้อความว่างเปล่าทุกคืน เพราะยังไม่มีใครซื้ออะไร
 * ช่วงหลังเที่ยงคืนถึงตีหก จึงถือว่ากำลังสรุป "วันที่เพิ่งจบไป"
 * ส่วนถ้ากดปุ่มดูเองระหว่างวัน ก็จะได้ยอดของวันนั้นตามปกติ
 */
function targetDay() {
  const bkk = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }))
  if (bkk.getHours() < 6) bkk.setDate(bkk.getDate() - 1)
  const y = bkk.getFullYear()
  const m = String(bkk.getMonth() + 1).padStart(2, '0')
  const d = String(bkk.getDate()).padStart(2, '0')
  return { date: bkk, iso: `${y}-${m}-${d}` }
}

const baht = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 2 })

/**
 * ประกอบข้อความสรุป
 * @param refresh ยิงถามยอดคงเหลือจากผู้ให้บริการก่อนไหม (ตัวสรุปรายวันควรถาม จะได้ตรงจริง)
 */
export async function buildDailySummary(refresh = true): Promise<string> {
  const day = targetDay()

  const [games, byProvider, totals] = await Promise.all([
    q<{ game: string; orders: number; total: number }>(
      `select coalesce(g.name, 'ไม่ระบุเกม') as game,
              count(*)::int as orders,
              coalesce(sum(s.total), 0)::float8 as total
         from sales s
         left join games g on g.id = s.game_id
        where s.status = 'paid'
          and (s.sold_at at time zone 'Asia/Bangkok')::date = $1::date
        group by coalesce(g.name, 'ไม่ระบุเกม')
        order by sum(s.total) desc`,
      [day.iso]
    ),
    q<{ provider: string; orders: number; cost: number }>(
      `select coalesce(ap.name, 'เติมเอง / ไม่ผ่าน API') as provider,
              count(*)::int as orders,
              coalesce(sum(s.cost_total), 0)::float8 as cost
         from sales s
         left join api_providers ap on ap.id = s.provider_id
        where s.status = 'paid'
          and (s.sold_at at time zone 'Asia/Bangkok')::date = $1::date
        group by coalesce(ap.name, 'เติมเอง / ไม่ผ่าน API')
        order by sum(s.cost_total) desc`,
      [day.iso]
    ),
    q<{ orders: number; total: number; cost: number; profit: number }>(
      `select count(*)::int as orders,
              coalesce(sum(total), 0)::float8 as total,
              coalesce(sum(cost_total), 0)::float8 as cost,
              coalesce(sum(profit), 0)::float8 as profit
         from sales
        where status = 'paid'
          and (sold_at at time zone 'Asia/Bangkok')::date = $1::date`,
      [day.iso]
    ),
  ])

  const sum = totals[0] ?? { orders: 0, total: 0, cost: 0, profit: 0 }

  // ยอดคงเหลือของผู้ให้บริการ — ยิงถามใหม่ให้ตรงกับความจริง ณ ตอนส่งสรุป
  const providers = await q<ProviderRow & { name: string }>(
    `select id, name, kind, base_url, username, api_key, sandbox,
            balance::float8 as balance, balance_at
       from api_providers where is_active order by priority, name`
  )

  if (refresh) {
    for (const p of providers) {
      try {
        // force = ไม่เอาค่าที่แคชไว้ ต้องถามใหม่จริง ๆ ตัวเลขในสรุปจะได้ตรงกับหน้าเว็บของเขา
        const fresh = await providerBalance(p, { force: true })
        p.balance = fresh.balance
      } catch {
        // ถามไม่ได้ก็ใช้ค่าที่จำไว้ล่าสุด ดีกว่าไม่ส่งสรุปเลย
      }
    }
  }

  const lines: string[] = [`📊 สรุปยอดขาย ${thaiDateLabel(day.date)}`, '']

  lines.push('🎮 เติมเกม')
  if (games.length === 0) {
    lines.push('• วันนี้ยังไม่มีบิลที่ชำระแล้ว')
  } else {
    for (const g of games) {
      lines.push(`• ${g.game} — ${baht(g.total)} บาท (${g.orders} บิล)`)
    }
  }

  lines.push('', '💸 ต้นทุนที่จ่ายผ่านผู้ให้บริการ')
  if (byProvider.length === 0) {
    lines.push('• ไม่มี')
  } else {
    for (const p of byProvider) {
      lines.push(`• ${p.provider} — ${baht(p.cost)} บาท (${p.orders} บิล)`)
    }
  }

  lines.push('', '💰 ยอดคงเหลือที่ผู้ให้บริการ')
  if (providers.length === 0) {
    lines.push('• ยังไม่ได้ต่อผู้ให้บริการ')
  } else {
    for (const p of providers) {
      lines.push(`• ${p.name} — ${p.balance == null ? 'ยังไม่เคยเช็ก' : `${baht(p.balance)} บาท`}`)
    }
  }

  lines.push(
    '',
    '📈 สรุปรวม',
    `• ยอดขาย ${baht(sum.total)} บาท (${sum.orders} บิล)`,
    `• ต้นทุน ${baht(sum.cost)} บาท`,
    `• กำไร ${baht(sum.profit)} บาท`
  )

  return lines.join('\n')
}

/** ประกอบแล้วส่งเข้า LINE เลย */
export async function sendDailySummary(refresh = true) {
  const text = await buildDailySummary(refresh)
  const sent = await notifyLine(text)
  return { sent, text }
}
