import 'server-only'
import { q, q1 } from '@/lib/db'
import { BuymError } from '@/lib/providers/24buym'
import { adapterFor, toConfig } from '@/lib/providers/registry'
import { OutOfTime } from '@/lib/providers/http'
import { ProviderError, type CatalogEntry } from '@/lib/providers/types'
import { notifyLine } from '@/lib/line'
import { friendlyError } from '@/lib/form'
import { dedupeEntries, dedupeNote, type CatalogEntryRow } from '@/lib/catalogDedupe'
import { buildRunReport } from '@/lib/priceReport'

export { buildRunReport } from '@/lib/priceReport'

export type { CatalogEntryRow } from '@/lib/catalogDedupe'

/**
 * เครื่องยนต์กลางของการดึงราคาจากผู้ให้บริการมาอัปเดตต้นทุน
 *
 * แยกออกมาจาก actions/catalogSync.ts เพราะไฟล์นั้นเป็น 'use server'
 * ซึ่งทุกฟังก์ชันที่ export จะกลายเป็นปลายทางที่เบราว์เซอร์ยิงเรียกได้
 * ของที่ไม่มีด่านตรวจสิทธิ์ในตัวจึงห้ามอยู่ในไฟล์นั้นเด็ดขาด
 */


export type AppliedChanges = {
  updated: number
  /** ต้นทุนที่เปลี่ยน (มากสุดก่อน) พร้อมชื่อเกม ไว้รายงานให้เห็นว่ากระทบอะไร */
  changes: Array<{ game: string; name: string; old_cost: number; new_cost: number }>
  /** แพ็กที่ตอนนี้ขายต่ำกว่าทุน — เกิดกับแพ็กที่ตั้งราคาเองแล้วปลายทางขึ้นราคา */
  losing: Array<{ name: string; cost_price: number; sell_price: number }>
  /** แพ็กที่ถูกซ่อม "ชนิดสินค้า" ให้ตรงกับปลายทาง (เคยจับคู่ผิดตัวอยู่) */
  repaired: Array<{ name: string; product_type: string }>
  /** แพ็กที่เปิดขายอยู่แต่หาคู่ในรายการของปลายทางไม่เจอ — ราคาจะค้างของเก่า */
  unmatched: number
  /** แพ็กที่ยังน่าสงสัยว่าจับคู่ข้ามเกมอยู่ — ซ่อมอัตโนมัติให้ไม่ได้ ต้องมีคนดู */
  suspect: Array<{ name: string; our_game: string; their_game: string }>
  summary: string
}

/* ------------------------------ บันทึกลงตารางกลาง ------------------------------ */

type Row = [
  number, string, string, string, string | null,
  string, string, string, number, string | null, string | null,
]

/**
 * บันทึกรายการที่ดึงมาลงตารางกลาง (เขียนทับของเดิมที่รหัสตรงกัน)
 * ใช้ร่วมกันทั้งตอนดึงทั้งร้านและตอนดึงเฉพาะที่เปิดขาย
 */
export async function saveCatalog(providerId: number, entries: CatalogEntryRow[]) {
  const deduped = dedupeEntries(entries)

  const rows: Row[] = deduped.entries.map((e) => [
    providerId,
    e.gameId,
    e.gameName,
    e.serverId,
    e.serverName,
    e.sku,
    e.packName,
    e.packDesc,
    e.price,
    // เก็บเป็นข้อความ JSON แล้วให้ Postgres แปลงเป็น jsonb ตอน insert
    // แยกให้ชัดระหว่าง [] (ถามแล้ว ไม่มีช่องกรอกจริง ๆ) กับ null (ยังไม่รู้ ต้องไปถามใหม่)
    e.fields ? JSON.stringify(e.fields) : null,
    // ชนิดสินค้าเป็นส่วนหนึ่งของกุญแจ จึงต้องเป็นข้อความเสมอ ห้าม null
    // (ในดัชนีของ SQL ค่า null ไม่เท่ากับ null แถวจะซ้ำได้ไม่จำกัด)
    e.productType ?? '',
  ])

  // ยัดทีละก้อนใหญ่ (800 × 11 ช่อง = 8,800 ตัวแปร ยังห่างเพดาน 65,535 ของ Postgres)
  // ฐานข้อมูลต่อได้ทีละคำสั่ง การลดจำนวนรอบไป-กลับจึงช่วยได้ตรง ๆ
  const CHUNK = 800
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const values = chunk
      .map((_, n) => {
        const b = n * 11
        return (
          `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},` +
          `$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10}::jsonb,$${b + 11})`
        )
      })
      .join(',')
    await q(
      `insert into provider_catalog
         (provider_id, game_id, game_name, server_id, server_name, pack_code, pack_name,
          pack_desc, pack_price, fields, product_type)
       values ${values}
       on conflict (provider_id, game_id, server_id, pack_code, product_type) do update
          set game_name = excluded.game_name,
              server_name = excluded.server_name,
              pack_name = excluded.pack_name,
              pack_desc = excluded.pack_desc,
              pack_price = excluded.pack_price,
              fields = excluded.fields,
              synced_at = now()`,
      chunk.flat()
    )
  }

  return { saved: rows.length, dedupe: deduped, note: dedupeNote(deduped) }
}

/* --------------------- เอาราคาในตารางกลางไปใส่แพ็กเกจของร้าน --------------------- */

/**
 * เอาราคา/ช่องกรอกล่าสุดในตารางกลาง ไปใส่แพ็กเกจที่ร้านนำเข้าไปแล้ว
 *
 * กฎสำคัญ: **ห้ามทับราคาขายที่ตั้งไว้เอง**
 *  - แพ็กที่ตั้งกำไรเป็น % ไว้ → คิดราคาขายใหม่จากต้นทุนใหม่ กำไรคงเดิม
 *  - แพ็กที่พิมพ์ราคาขายเอง   → ราคาขายไม่ขยับเลย อัปเดตแค่ต้นทุน
 *    (ต้นทุนที่ถูกต้องทำให้กำไรที่แสดงตรงความจริง และกันขายต่ำกว่าทุนโดยไม่รู้ตัว)
 *
 * ไม่แตะ ชื่อ รูป สถานะเปิดขาย สต๊อก หรือลำดับการแสดง — ของพวกนี้ร้านตั้งเอง
 */
export async function applyCatalogToProducts(providerId: number): Promise<AppliedChanges> {
  /*
   * ซ่อม "ชนิดสินค้า" ของแพ็กที่เคยจับคู่ผิดตัวก่อนเป็นอันดับแรก
   *
   * ก่อนหน้านี้ระบบถือว่ารหัสสินค้าที่ตรงกันคือของชิ้นเดียวกัน สินค้าคนละชนิด
   * ของ OverTopup ที่รหัสชนกันจึงทับกัน และแพ็กของเราถูกเปลี่ยนชนิดตามตัวที่มาทีหลัง
   * (ทุน RoV 6,200 คูปอง กลายเป็นราคาบัตร Steam 200 บาท เมื่อ 21 ส.ค. 2569)
   *
   * ตัวชี้ขาดว่าอันไหนคือของจริงคือ **ชื่อเกม** — ชื่อเกมของแพ็กในระบบเรา
   * ไม่เคยถูกรอบดึงราคาเขียนทับ จึงเชื่อถือได้กว่ารหัสและชนิดที่เก็บไว้
   * ถ้าชื่อเกมไม่ตรงกับรายการไหนเลย จะไม่แตะอะไรทั้งนั้น (ปล่อยค้างดีกว่าเดาผิด)
   */
  const repaired = await q<{ name: string; product_type: string }>(
    `update products p
        set provider_product_type = nullif(c.product_type, '')
       from provider_catalog c
       join games g on lower(g.name) = lower(c.game_name)
      where c.provider_id = p.provider_id
        and c.game_id = p.provider_game_id
        and c.server_id = p.provider_server_id
        and c.pack_code = p.provider_sku
        and g.id = p.game_id
        and p.provider_id = $1
        and coalesce(p.provider_product_type, '') is distinct from c.product_type
     returning p.name, c.product_type`,
    [providerId]
  )

  // ดูก่อนว่าต้นทุนของแพ็กไหนเปลี่ยนบ้าง จะได้รายงานให้เห็นว่ากระทบอะไร
  const changes = await q<{ game: string; name: string; old_cost: number; new_cost: number }>(
    `select coalesce(g.name, '(ไม่ทราบเกม)') as game, p.name,
            p.cost_price::float8 as old_cost, c.pack_price::float8 as new_cost
       from products p
       left join games g on g.id = p.game_id
       join provider_catalog c
         on c.provider_id = p.provider_id
        and c.game_id = p.provider_game_id
        and c.server_id = p.provider_server_id
        and c.pack_code = p.provider_sku
        and c.product_type = coalesce(p.provider_product_type, '')
      where p.provider_id = $1 and p.cost_price is distinct from c.pack_price
      order by abs(c.pack_price - p.cost_price) desc
      limit 40`,
    [providerId]
  )

  const updated = await q<{ id: number }>(
    `update products p
        set cost_price = c.pack_price,
            provider_fields = c.fields,
            provider_variant = c.game_name,
            sell_price = case when p.markup_percent is not null
                              then ceil(c.pack_price * (1 + p.markup_percent / 100))
                              else p.sell_price end,
            partner_price = case when p.partner_markup_percent is not null
                                 then ceil(c.pack_price * (1 + p.partner_markup_percent / 100))
                                 else p.partner_price end
       from provider_catalog c
      where c.provider_id = p.provider_id
        and c.game_id = p.provider_game_id
        and c.server_id = p.provider_server_id
        and c.pack_code = p.provider_sku
        -- ชนิดสินค้าต้องตรงด้วย ไม่งั้นแพ็กของเกม (uid) จะไปคว้าราคาของบัตรเงินสด (card)
        -- ที่บังเอิญมีรหัสเดียวกันมาใส่ ซึ่งเคยทำให้ทุน RoV 6,200 คูปอง เพี้ยนเหลือ 205 บาท
        and c.product_type = coalesce(p.provider_product_type, '')
        and p.provider_id = $1
        -- ต้องเช็กทุกคอลัมน์ที่คำสั่งนี้เขียน ไม่งั้นแถวที่ต่างกันเฉพาะคอลัมน์
        -- ที่ไม่ได้เช็กจะถูกข้ามไป แล้วกู้ข้อมูลที่หายไม่ได้
        and (p.cost_price is distinct from c.pack_price
             or p.provider_fields is distinct from c.fields
             or p.provider_variant is distinct from c.game_name)
     returning p.id`,
    [providerId]
  )

  // เตือนแพ็กที่ตอนนี้ขายต่ำกว่าทุน — เกิดได้กับแพ็กที่ตั้งราคาเองแล้วปลายทางขึ้นราคา
  const losing = await q<{ name: string; cost_price: number; sell_price: number }>(
    `select name, cost_price::float8 as cost_price, sell_price::float8 as sell_price
       from products
      where provider_id = $1 and is_active and sell_price < cost_price
      order by (cost_price - sell_price) desc
      limit 5`,
    [providerId]
  )

  /*
   * แพ็กที่เปิดขายอยู่แต่หาคู่ในรายการของปลายทางไม่เจอ
   * ราคาทุนของพวกนี้จะค้างของเก่าไว้เงียบ ๆ ซึ่งอันตรายพอ ๆ กับราคาผิด จึงต้องนับและบอก
   */
  const gap = await q1<{ n: number }>(
    `select count(*)::int as n
       from products p
      where p.provider_id = $1 and p.is_active and p.provider_game_id is not null
        and not exists (
          select 1 from provider_catalog c
           where c.provider_id = p.provider_id
             and c.game_id = p.provider_game_id
             and c.server_id = p.provider_server_id
             and c.pack_code = p.provider_sku
             and c.product_type = coalesce(p.provider_product_type, ''))`,
    [providerId]
  )
  const unmatched = gap?.n ?? 0

  /*
   * แพ็กที่ยังน่าสงสัยว่าจับคู่ข้ามเกมอยู่
   *
   * ตัวซ่อมอัตโนมัติด้านบนใช้ "ชื่อเกมตรงกัน" เป็นตัวชี้ขาด ถ้าร้านเคยเปลี่ยนชื่อเกม
   * ในระบบเราจนไม่ตรงกับที่ปลายทางเรียก มันจะซ่อมให้ไม่ได้และจะเงียบไปเฉย ๆ
   * จึงต้องมีตัวจับอีกชั้น: แพ็กที่จับคู่กับรายการที่ "ชื่อเกมไม่ตรง" ทั้งที่รหัสเดียวกัน
   * มีของอีกชนิดอยู่ด้วย = มีโอกาสสูงที่ยังคว้าผิดตัวอยู่ ต้องให้คนเข้าไปดู
   */
  const suspect = await q<{ name: string; our_game: string; their_game: string }>(
    `select p.name, g.name as our_game, c.game_name as their_game
       from products p
       join games g on g.id = p.game_id
       join provider_catalog c
         on c.provider_id = p.provider_id
        and c.game_id = p.provider_game_id
        and c.server_id = p.provider_server_id
        and c.pack_code = p.provider_sku
        and c.product_type = coalesce(p.provider_product_type, '')
      where p.provider_id = $1 and p.is_active
        and lower(g.name) <> lower(c.game_name)
        and exists (
          select 1 from provider_catalog c2
           where c2.provider_id = c.provider_id
             and c2.game_id = c.game_id
             and c2.server_id = c.server_id
             and c2.pack_code = c.pack_code
             and c2.product_type <> c.product_type)
      limit 5`,
    [providerId]
  )

  const detail = changes
    .slice(0, 5)
    .map(
      (c) =>
        `${c.name} ${c.old_cost.toLocaleString('th-TH')}→${c.new_cost.toLocaleString('th-TH')}`
    )
    .join(' · ') + (changes.length > 5 ? ` และอีก ${changes.length - 5} รายการ` : '')

  const warn =
    losing.length > 0
      ? ` ⚠ ขายต่ำกว่าทุน ${losing.length} แพ็ก: ` +
        losing.map((l) => `${l.name} (ทุน ${l.cost_price} ขาย ${l.sell_price})`).join(' · ') +
        ' — ไปแก้ราคาขายด่วน'
      : ''

  const fixed =
    repaired.length > 0
      ? ` 🔧 ซ่อมชนิดสินค้าที่จับคู่ผิดตัว ${repaired.length} แพ็ก: ` +
        repaired.slice(0, 5).map((r) => `${r.name} → ${r.product_type || 'ไม่ระบุ'}`).join(' · ')
      : ''
  const missing =
    unmatched > 0
      ? ` ⚠ อีก ${unmatched} แพ็กที่เปิดขายอยู่หาคู่ในรายการของปลายทางไม่เจอ ` +
        `(ราคาทุนค้างของเก่า) — กด "ดึงรายการทั้งหมด" ของเจ้านี้เพื่อเติมรายการให้ครบ`
      : ''
  const crossed =
    suspect.length > 0
      ? ` ❗ ตรวจด่วน ${suspect.length} แพ็กอาจจับคู่ข้ามเกมอยู่: ` +
        suspect
          .map((x) => `${x.name} (เกมเรา "${x.our_game}" แต่ไปคว้าของ "${x.their_game}")`)
          .join(' · ')
      : ''

  return {
    updated: updated.length,
    changes,
    losing,
    repaired,
    unmatched,
    suspect,
    summary:
      updated.length === 0
        ? `ข้อมูลตรงกับผู้ให้บริการอยู่แล้ว${fixed}${missing}${crossed}`
        : `อัปเดต ${updated.length} แพ็กเกจ — ราคาขายที่ตั้งเองไม่ถูกแตะ ` +
          `ส่วนแพ็กที่ตั้งกำไรเป็น % ไว้คิดราคาใหม่ให้แล้ว` +
          (detail ? ` · ต้นทุนที่เปลี่ยน: ${detail}` : '') +
          fixed +
          warn +
          missing +
          crossed,
  }
}

/**
 * ส่งแจ้งเตือนเข้า LINE เมื่อผู้ให้บริการเปลี่ยนราคา
 *
 * เรื่องนี้ต้องรู้ทันทีแม้ไม่ได้นั่งอยู่หน้าจอ เพราะทุนขึ้นแปลว่ากำไรหด
 * และแพ็กที่ตั้งราคาขายเองไว้อาจกลายเป็นขายต่ำกว่าทุนตั้งแต่วินาทีนั้น
 * ส่งแบบไม่รอผล (void) และกลืน error — แจ้งเตือนไม่ควรทำให้การอัปเดตราคาล้ม
 */
export async function notifyPriceChange(providerName: string, applied: AppliedChanges) {
  if (
    applied.changes.length === 0 &&
    applied.losing.length === 0 &&
    applied.repaired.length === 0
  ) {
    return
  }
  try {
    const lines = [
      `💰 ${providerName} เปลี่ยนราคาทุน ${applied.updated} แพ็กเกจ`,
      ...applied.changes.map((c) => {
        const arrow = c.new_cost > c.old_cost ? '▲' : '▼'
        return `${arrow} ${c.name}: ${c.old_cost.toLocaleString('th-TH')} → ${c.new_cost.toLocaleString('th-TH')} บาท`
      }),
    ]
    if (applied.losing.length > 0) {
      lines.push('', `⚠️ ขายต่ำกว่าทุน ${applied.losing.length} แพ็ก ต้องรีบแก้ราคาขาย:`)
      for (const l of applied.losing) {
        lines.push(`• ${l.name} — ทุน ${l.cost_price} ขาย ${l.sell_price}`)
      }
    }
    if (applied.repaired.length > 0) {
      lines.push('', `🔧 ซ่อมชนิดสินค้าที่จับคู่ผิดตัว ${applied.repaired.length} แพ็ก:`)
      for (const r of applied.repaired.slice(0, 10)) {
        lines.push(`• ${r.name} → ${r.product_type || 'ไม่ระบุ'}`)
      }
      lines.push('ตรวจราคาขายของแพ็กพวกนี้ด้วย เพราะทุนที่เคยผิดอาจดันราคาขายเพี้ยนไปแล้ว')
    }
    lines.push('', 'อย่าลืมกด "อัปเดตราคาขึ้นหน้าเว็บ" ให้ลูกค้าเห็นราคาใหม่')
    await notifyLine(lines.join('\n'))
  } catch {
    // แจ้งเตือนไม่สำเร็จไม่ใช่เรื่องคอขาดบาดตาย ข้อมูลราคาอัปเดตไปแล้ว
  }
}

/* ---------------------- ดึงราคาเฉพาะของที่เปิดขายอยู่จริง ---------------------- */

export type ProviderRow = {
  id: number
  name: string
  base_url: string | null
  username: string | null
  api_key: string | null
  kind: string
  sandbox: boolean
}

const PROVIDER_COLUMNS = 'id, name, base_url, username, api_key, kind, sandbox'

export function getProvider(providerId: number) {
  return q1<ProviderRow>(`select ${PROVIDER_COLUMNS} from api_providers where id = $1`, [providerId])
}

export type Published = {
  /** จำนวนแพ็กที่ราคาขึ้นหน้าเว็บให้ลูกค้าเห็นแล้ว */
  count: number
  /** แพ็กที่ไม่ยอมเผยแพร่ให้ เพราะราคาขายต่ำกว่าทุน (ขายไปเท่ากับขาดทุนแน่นอน) */
  held: Array<{ name: string; cost: number; sell: number }>
}

/**
 * เผยแพร่ราคาที่เพิ่งคำนวณใหม่ขึ้นหน้าเว็บลูกค้า
 *
 * หน้าเว็บลูกค้าอ่านจากช่อง "ราคาที่เผยแพร่แล้ว" ไม่ใช่ช่องราคาที่หลังร้านตั้งไว้
 * ปกติต้องกดปุ่มเอง แต่เจ้าของร้านสั่งให้ขึ้นเองอัตโนมัติหลังดึงราคาเสร็จ (22 ส.ค. 2569)
 *
 * ข้อยกเว้นเดียว: **แพ็กที่ราคาขายต่ำกว่าทุน จะไม่ถูกเผยแพร่**
 * เพราะขายออกไปคือขาดทุนทุกบิลแน่นอน ไม่มีทางเป็นสิ่งที่ร้านตั้งใจ
 * ของพวกนี้จะค้างราคาเดิมไว้บนเว็บและถูกรายงานเข้า LINE ให้ไปแก้
 */
export async function publishPrices(providerId: number): Promise<Published> {
  // ดูก่อนว่าอันไหนจะถูกกันไว้ ต้องอ่านก่อนอัปเดต ไม่งั้นมันจะหายไปจากเงื่อนไข
  const held = await q<{ name: string; cost: number; sell: number }>(
    `select name, cost_price::float8 as cost, sell_price::float8 as sell
       from products
      where provider_id = $1 and is_active
        and (published_sell_price is distinct from sell_price
             or published_partner_price is distinct from partner_price)
        and (sell_price < cost_price
             or (partner_price is not null and partner_price < cost_price))
      order by (cost_price - sell_price) desc
      limit 10`,
    [providerId]
  )

  const updated = await q<{ id: number }>(
    `update products
        set published_sell_price = sell_price,
            published_partner_price = partner_price
      where provider_id = $1
        and (published_sell_price is distinct from sell_price
             or published_partner_price is distinct from partner_price)
        and sell_price >= cost_price
        and (partner_price is null or partner_price >= cost_price)
     returning id`,
    [providerId]
  )

  return { count: updated.length, held }
}

export type RefreshResult = {
  provider: string
  /** ทำสำเร็จไหม — ไม่สำเร็จต้องมี error เสมอ */
  ok: boolean
  error?: string
  games: number
  packs: number
  fetchMs: number
  saveMs: number
  applied?: AppliedChanges
  /** ผลการเอาราคาขึ้นหน้าเว็บลูกค้า */
  published?: Published
  /** หมายเหตุจากตัวเชื่อม หรือเรื่องรายการซ้ำ */
  note?: string | null
}

/**
 * ดึงราคาเฉพาะสินค้าที่ร้าน "เปิดขายอยู่จริง" แล้วอัปเดตให้ในคำสั่งเดียว
 *
 * ต่างจากการดึงทั้งร้านตรงที่ไม่ไปแตะเกมที่เราไม่ได้ขาย — ซึ่งเป็นส่วนใหญ่ของรายการ
 * ผลคือเร็วกว่ามาก ไม่ไปเบียดเพดานการยิงของปลายทาง และทำบ่อยได้โดยไม่เจ็บ
 */
export async function refreshSellingPrices(provider: ProviderRow): Promise<RefreshResult> {
  const base: RefreshResult = {
    provider: provider.name,
    ok: false,
    games: 0,
    packs: 0,
    fetchMs: 0,
    saveMs: 0,
  }

  if (!provider.api_key) {
    return { ...base, error: `"${provider.name}" ยังไม่ได้ตั้งคีย์/รหัสผ่าน` }
  }

  const adapter = adapterFor(provider.kind)
  if (!adapter.fetchCatalog) {
    return { ...base, error: `"${provider.name}" ยังไม่รองรับการดึงรายการอัตโนมัติ` }
  }

  try {
    // เกมที่ผูกกับเจ้านี้และยังเปิดขายอยู่ (ปิดขายไปแล้วไม่ต้องเสียเวลาดึง)
    const selling = await q<{ game_id: string }>(
      `select distinct provider_game_id as game_id
         from products
        where provider_id = $1 and is_active and provider_game_id is not null`,
      [provider.id]
    )
    if (selling.length === 0) {
      return {
        ...base,
        error: `ยังไม่มีแพ็กเกจของ "${provider.name}" ที่เปิดขายอยู่ — กดดึงทั้งร้านแล้วนำเข้าก่อน`,
      }
    }
    const only = new Set(selling.map((r) => r.game_id))

    const startedAt = Date.now()
    const result = await adapter.fetchCatalog(toConfig(provider), { only })
    const fetchMs = Date.now() - startedAt
    const all: CatalogEntry[] = Array.isArray(result) ? result : result.entries
    const adapterNote = Array.isArray(result) ? null : result.note

    // เจ้าที่ยิงครั้งเดียวได้ทั้งร้าน (24BUYM/OverTopup) จะไม่สนใจ only มาก่อน จึงกรองซ้ำที่นี่
    const entries = all.filter((e) => only.has(e.gameId))
    if (entries.length === 0) {
      return {
        ...base,
        games: only.size,
        fetchMs,
        error:
          'ปลายทางไม่ได้ส่งราคาของเกมที่เปิดขายอยู่กลับมาเลย — ' +
          'อาจถูกปิดขายที่ฝั่งผู้ให้บริการแล้ว ลองกดดึงทั้งร้านเพื่อตรวจสอบ',
      }
    }

    const saved = await saveCatalog(provider.id, entries)
    const applied = await applyCatalogToProducts(provider.id)
    // ราคาที่คำนวณใหม่ต้องถึงมือลูกค้าเลย ไม่ต้องรอคนมากดปุ่มเผยแพร่
    const published = await publishPrices(provider.id)

    return {
      provider: provider.name,
      ok: true,
      games: only.size,
      packs: saved.saved,
      fetchMs,
      saveMs: Date.now() - startedAt - fetchMs,
      applied,
      published,
      note: [adapterNote, saved.note].filter(Boolean).join(' · ') || null,
    }
  } catch (err) {
    if (err instanceof OutOfTime) {
      return {
        ...base,
        error: 'ดึงไม่ทันในเวลาที่มี — สั่งดึงอีกครั้ง ระบบจะไปต่อจากที่ค้างไว้',
      }
    }
    if (err instanceof ProviderError) return { ...base, error: err.message }
    if (err instanceof BuymError) return { ...base, error: err.message }
    return { ...base, error: friendlyError(err, 'ดึงราคาไม่สำเร็จ') }
  }
}

/* --------------------- ตรวจว่าเกมบนเว็บอัปเดตได้ครบไหม --------------------- */

export type CoverageGap = {
  game: string
  /** แพ็กที่เปิดขายอยู่ทั้งหมดของเกมนี้ */
  total: number
  /** แพ็กที่ไม่ได้ผูกกับผู้ให้บริการเลย — ต้องแก้ราคาเอง ระบบอัปเดตให้ไม่ได้ */
  manual: number
  /** แพ็กที่ผูกไว้แล้วแต่หาคู่ในรายการของปลายทางไม่เจอ — ราคาค้างของเก่า */
  unmatched: number
}

/**
 * เกมที่เปิดขายบนหน้าเว็บแต่ระบบอัปเดตราคาให้ไม่ครบ
 *
 * ตอบคำถามว่า "เกมบนเว็บอัปเดตได้หมดจริงไหม" ด้วยรายชื่อ ไม่ใช่การเดา
 * เกมที่ไม่โผล่ในรายการนี้ = แพ็กทุกตัวของมันผูกกับผู้ให้บริการและจับคู่ได้ครบ
 *
 * สองสาเหตุที่เป็นไปได้ต่างกันคนละเรื่อง จึงต้องแยกนับ:
 *  - manual = ร้านตั้งขายเอง ไม่ได้ผูกกับใคร (เช่นบัตรที่ซื้อมาเก็บสต๊อก) ตั้งใจให้เป็นแบบนั้น
 *  - unmatched = ผูกไว้แล้วแต่คว้าของไม่เจอ อันนี้ผิดปกติ ต้องไปกดดึงรายการทั้งหมดใหม่
 */
export async function coverageGaps(): Promise<CoverageGap[]> {
  try {
    return await q<CoverageGap>(
      `select * from (
         select g.name as game,
                count(*)::int as total,
                sum(case when p.provider_id is null then 1 else 0 end)::int as manual,
                sum(case when p.provider_id is not null and c.id is null then 1 else 0 end)::int
                  as unmatched
           from products p
           join games g on g.id = p.game_id
           left join provider_catalog c
             on c.provider_id = p.provider_id
            and c.game_id = p.provider_game_id
            and c.server_id = p.provider_server_id
            and c.pack_code = p.provider_sku
            and c.product_type = coalesce(p.provider_product_type, '')
          where p.is_active and g.is_published
          group by g.name
       ) t
       where t.manual > 0 or t.unmatched > 0
       order by t.game`
    )
  } catch {
    // ถามไม่ได้ก็ไม่ควรทำให้ทั้งรอบล้ม — รายงานจะบอกว่าตรวจไม่ได้แทน
    return []
  }
}

/* ------------------------- รอบอัตโนมัติวันละครั้ง ------------------------- */

/** กันงานถูกตัดกลางคัน — เผื่อเวลาไว้เขียนสรุปและส่ง LINE หลังหมดงบเวลา */
const RESERVE_MS = 8_000

export type DailyRunResult = {
  results: RefreshResult[]
  /** รหัสเจ้าที่ยังไม่ได้ทำในรอบนี้เพราะเวลาจะหมด — ต้องเอาไปทำต่อ */
  pending: number[]
  /** ชื่อเจ้าที่ยังไม่ได้ทำ ไว้เขียนรายงาน */
  pendingNames: string[]
  total: number
}

/** ผู้ให้บริการทุกเจ้าที่มีสินค้าเปิดขายอยู่บนเว็บจริง ๆ */
export async function providersInUse(): Promise<ProviderRow[]> {
  return q<ProviderRow>(
    `select distinct pr.id, pr.name, pr.base_url, pr.username, pr.api_key, pr.kind, pr.sandbox
       from api_providers pr
       join products p on p.provider_id = pr.id
      where p.is_active and p.provider_game_id is not null
      order by pr.id`
  )
}

/**
 * ดึงราคาของทุกเจ้าที่มีของขายอยู่บนเว็บ ทีละเจ้าจนกว่าจะหมดงบเวลา
 *
 * Vercel ตัดการทำงานที่ 60 วินาที ถ้าโดนตัดกลางคันคือไม่ได้อะไรเลยและไม่มีใครรู้
 * จึงต้องมีเส้นตายของตัวเอง แล้วคืนรายชื่อเจ้าที่ยังไม่ได้ทำกลับไป
 * ให้ปลายทางตัดสินใจว่าจะเรียกรอบต่อไปหรือจะรายงานว่าทำไม่ครบ
 */
export async function refreshAllSellingPrices(opts: {
  /** เวลา (Date.now()) ที่ต้องหยุด */
  deadline: number
  /** ทำเฉพาะรหัสเจ้านี้ — ใช้ตอนทำต่อจากรอบก่อน */
  only?: number[] | null
}): Promise<DailyRunResult> {
  const all = await providersInUse()
  const queue = opts.only?.length ? all.filter((p) => opts.only!.includes(p.id)) : all

  const results: RefreshResult[] = []
  const pending: ProviderRow[] = []

  for (const [i, provider] of queue.entries()) {
    // เจ้าแรกต้องได้ลองเสมอ ไม่งั้นรอบที่เริ่มช้าจะไม่ทำอะไรเลยแล้ววนไม่จบ
    if (i > 0 && Date.now() > opts.deadline - RESERVE_MS) {
      pending.push(...queue.slice(i))
      break
    }
    results.push(await refreshSellingPrices(provider))
  }

  return {
    results,
    pending: pending.map((p) => p.id),
    pendingNames: pending.map((p) => p.name),
    total: queue.length,
  }
}

/** สรุปผลรอบอัตโนมัติเป็นข้อความบรรทัดเดียว ไว้โชว์ในหลังร้าน */
export function summarizeRun(run: DailyRunResult): string {
  const ok = run.results.filter((r) => r.ok)
  const bad = run.results.filter((r) => !r.ok)
  const changed = ok.reduce((n, r) => n + (r.applied?.updated ?? 0), 0)

  const parts = [`สำเร็จ ${ok.length}/${run.total} เจ้า`, `อัปเดต ${changed} แพ็กเกจ`]
  if (bad.length > 0) parts.push(`ล้มเหลว ${bad.map((r) => r.provider).join(', ')}`)
  if (run.pendingNames.length > 0) parts.push(`ยังไม่ได้ทำ ${run.pendingNames.join(', ')}`)
  return parts.join(' · ')
}

/**
 * จดผลรอบล่าสุดไว้ให้หลังร้านเห็น
 *
 * ต้องรู้ให้ได้ว่า "รอบอัตโนมัติทำงานอยู่จริงไหม" โดยไม่ต้องไปไล่ดู log ของ Vercel
 * ถ้าเงียบไปหลายวันแล้วราคาทุนเพี้ยน จะได้รู้ว่าต้นเหตุอยู่ตรงไหน
 */
export async function recordRefreshRun(text: string, ok: boolean) {
  try {
    await q(
      `insert into site_settings (key, value) values ('price_refresh_last', $1)
       on conflict (key) do update set value = excluded.value`,
      [JSON.stringify({ at: new Date().toISOString(), ok, text })]
    )
  } catch {
    // จดไม่ได้ไม่ใช่เรื่องใหญ่ ราคาอัปเดตไปเรียบร้อยแล้ว
  }
}

export type LastRefreshRun = { at: string; ok: boolean; text: string }

/** อ่านผลรอบล่าสุด — คืน null ถ้ายังไม่เคยรัน หรืออ่านไม่ได้ */
export async function lastRefreshRun(): Promise<LastRefreshRun | null> {
  try {
    const row = await q1<{ value: string | null }>(
      `select value from site_settings where key = 'price_refresh_last'`
    )
    if (!row?.value) return null
    const parsed = JSON.parse(row.value) as LastRefreshRun
    return typeof parsed?.at === 'string' ? parsed : null
  } catch {
    return null
  }
}

/**
 * ส่งรายงานรอบอัตโนมัติเข้า LINE — ส่งทุกวันเสมอ ไม่ว่าจะมีอะไรเปลี่ยนหรือไม่
 *
 * กลืน error ไว้ ส่งไม่สำเร็จไม่ควรทำให้รอบอัตโนมัติล้ม เพราะราคาอัปเดตไปเรียบร้อยแล้ว
 */
export async function notifyRun(run: DailyRunResult, opts?: { chained?: boolean }) {
  try {
    await notifyLine(buildRunReport(run, opts))
  } catch {
    // ส่งไม่ได้ก็ไม่เป็นไร ผลรอบล่าสุดยังดูได้จากหน้าหลังร้าน
  }
}
