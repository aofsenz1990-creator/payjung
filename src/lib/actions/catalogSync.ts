'use server'

import { revalidatePath } from 'next/cache'
import { q, q1 } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { BuymError } from '@/lib/providers/24buym'
import { adapterFor, toConfig } from '@/lib/providers/registry'
import { ProviderError } from '@/lib/providers/types'
import { bool, decimal, friendlyError, int, str } from '@/lib/form'
import type { ActionState } from '@/components/ActionForm'

/**
 * ดึงรายการเกม/เซิร์ฟเวอร์/แพ็กเกจทั้งหมดจากผู้ให้บริการมาเก็บไว้
 * จะได้เลือกจับคู่ได้โดยไม่ต้องยิง API ซ้ำทุกครั้งที่เปิดหน้า
 */
export async function syncCatalogAction(formData: FormData): Promise<ActionState> {
  await requireAdmin()
  const providerId = int(formData, 'provider_id')
  if (!providerId) return { error: 'กรุณาเลือกผู้ให้บริการ' }

  const provider = await q1<{
    id: number
    name: string
    base_url: string | null
    username: string | null
    api_key: string | null
    kind: string
    sandbox: boolean
  }>(
    'select id, name, base_url, username, api_key, kind, sandbox from api_providers where id = $1',
    [providerId]
  )

  if (!provider) return { error: 'ไม่พบผู้ให้บริการนี้' }
  if (!provider.api_key) return { error: `"${provider.name}" ยังไม่ได้ตั้งคีย์/รหัสผ่าน` }

  const adapter = adapterFor(provider.kind)
  if (!adapter.fetchCatalog) {
    return {
      error: `"${provider.name}" ยังไม่รองรับการดึงรายการอัตโนมัติ — กรอกรหัสสินค้าเองที่หน้าแพ็กเกจ`,
    }
  }

  // OverTopup คิดราคาต่างกันตามระดับลูกค้า ดึงผิดระดับ = ราคาทุนในระบบไม่ตรงกับที่ถูกตัดจริง
  const vip = bool(formData, 'vip')

  try {
    const entries = await adapter.fetchCatalog(toConfig(provider), { vip })

    type Row = [
      number, string, string, string, string | null,
      string, string, string, number, string | null, string | null,
    ]
    const rows: Row[] = entries.map((e) => [
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
      e.fields && e.fields.length > 0 ? JSON.stringify(e.fields) : null,
      e.productType ?? null,
    ])

    if (rows.length === 0) return { error: 'ปลายทางไม่ได้ส่งรายการสินค้ามาเลย' }

    // ล้างของเก่าของเจ้านี้แล้วใส่ชุดใหม่ทั้งหมด จะได้ตรงกับปลายทางเสมอ
    await q('delete from provider_catalog where provider_id = $1', [providerId])

    const CHUNK = 400
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
         on conflict (provider_id, game_id, server_id, pack_code) do nothing`,
        chunk.flat()
      )
    }

    const games = new Set(rows.map((r) => r[1])).size
    revalidatePath('/storefront')
    return {
      ok:
        `ดึงรายการสำเร็จ — ${games} เกม รวม ${rows.length} รายการสินค้า` +
        (provider.kind === 'overtopup'
          ? ` (ราคาระดับ ${vip ? 'VIP' : 'ทั่วไป'} — ถ้าไม่ตรงกับที่ถูกตัดจริง ให้ดึงใหม่อีกระดับ)`
          : ''),
    }
  } catch (err) {
    if (err instanceof ProviderError) return { error: err.message }
    if (err instanceof BuymError) return { error: err.message }
    return { error: friendlyError(err, 'ดึงรายการสินค้าไม่สำเร็จ') }
  }
}

/**
 * นำเข้าเกมจากรายการที่ดึงมา — ทีละหลายเกม หรือทั้งหมดในครั้งเดียว
 *
 * เขียนเป็นคำสั่งชุดเดียวโดยตั้งใจ ไม่วนลูปทีละแพ็กเกจ
 * ผู้ให้บริการรายหนึ่งมีได้ร้อยกว่าเกม รวมพันกว่าแพ็กเกจ ถ้ายิงฐานข้อมูล
 * ทีละแพ็ก (เช็กซ้ำ 1 + เพิ่ม 1) จะกลายเป็นสองพันกว่าคำสั่ง ซึ่งไม่มีทางเสร็จทัน
 * แบบนี้ใช้แค่ 3 คำสั่งไม่ว่าจะนำเข้ากี่เกม
 */
export async function importGamesAction(formData: FormData): Promise<ActionState> {
  await requireAdmin()
  const providerId = int(formData, 'provider_id')
  const markup = decimal(formData, 'markup', 0)
  // เปิดขายบนเว็บทันทีตอนนำเข้า — ปิดไว้เป็นค่าเริ่มต้นเพราะถ้าไม่ได้ใส่กำไร
  // ราคาขายจะเท่าทุน เผลอเปิดไปคือขายไม่ได้กำไรเลย
  const publish = bool(formData, 'publish')
  const all = str(formData, 'all') === '1'
  const gameIds = formData.getAll('game_ids').filter((v): v is string => typeof v === 'string')

  if (!providerId) return { error: 'กรุณาเลือกผู้ให้บริการ' }
  if (markup < 0) return { error: 'เปอร์เซ็นต์กำไรต้องไม่ติดลบ' }
  if (!all && gameIds.length === 0) {
    return { error: 'ยังไม่ได้เลือกเกม — ติ๊กเกมที่ต้องการ แล้วกด "นำเข้าเกมที่เลือก"' }
  }

  try {
    const provider = await q1<{ name: string; kind: string }>(
      'select name, kind from api_providers where id = $1',
      [providerId]
    )
    if (!provider) return { error: 'ไม่พบผู้ให้บริการนี้' }

    // เงื่อนไขเลือกเกม — นำเข้าทั้งหมดก็ไม่ต้องกรอง
    const filterParams: unknown[] = [providerId]
    let gameFilter = ''
    if (!all) {
      const holes = gameIds.map((_, i) => `$${i + 2}`).join(',')
      gameFilter = ` and c.game_id in (${holes})`
      filterParams.push(...gameIds)
    }
    const next = () => `$${filterParams.length + 1}`

    // ① สร้างเกมที่ยังไม่มีในระบบ (ชื่อซ้ำถือว่าเป็นเกมเดิม ไม่สร้างซ้ำ)
    const pubHole = next()
    await q(
      `insert into games (name, publisher)
       select distinct c.game_name, ${pubHole}
         from provider_catalog c
        where c.provider_id = $1${gameFilter}
          and not exists (select 1 from games g where lower(g.name) = lower(c.game_name))
       on conflict do nothing`,
      [...filterParams, provider.name]
    )

    // ② เพิ่มเฉพาะแพ็กเกจที่ยังไม่เคยนำเข้า ดูจากรหัสฝั่งผู้ให้บริการ
    const insertParams = [...filterParams]
    const mHole = `$${insertParams.length + 1}`
    insertParams.push(markup)
    const pHole = `$${insertParams.length + 1}`
    insertParams.push(publish)

    const added = await q<{ id: number }>(
      `insert into products
         (game_id, name, cost_price, sell_price, is_active, sort_order,
          provider_id, provider_game_id, provider_server_id, provider_sku,
          provider_product_type, markup_percent, is_published, provider_fields, provider_variant)
       select g.id,
              case when c.server_name is not null and c.server_id <> '0'
                   then c.pack_name || ' (' || c.server_name || ')'
                   else c.pack_name end,
              c.pack_price,
              ceil(c.pack_price * (1 + ${mHole}::numeric / 100)),
              true,
              round(c.pack_price)::int,
              c.provider_id, c.game_id, c.server_id, c.pack_code,
              c.product_type, nullif(${mHole}::numeric, 0), ${pHole}, c.fields, c.game_name
         from provider_catalog c
         join games g on lower(g.name) = lower(c.game_name)
        where c.provider_id = $1${gameFilter}
          and not exists (
            select 1 from products p
             where p.provider_id = c.provider_id
               and p.provider_game_id = c.game_id
               and p.provider_server_id = c.server_id
               and p.provider_sku = c.pack_code)
       returning id`,
      insertParams
    )

    // ③ เปิดขายบนเว็บ — ต้องเปิดตัวเกมด้วย ไม่ใช่แค่แพ็กเกจ ไม่งั้นลูกค้าไม่เห็นอะไรเลย
    let publishedGames = 0
    if (publish) {
      const rows = await q<{ id: number }>(
        `update games set is_published = true
          where id in (select g.id
                         from provider_catalog c
                         join games g on lower(g.name) = lower(c.game_name)
                        where c.provider_id = $1${gameFilter})
            and not is_published
         returning id`,
        filterParams
      )
      publishedGames = rows.length
    }

    revalidatePath('/storefront')
    revalidatePath('/games')
    revalidatePath('/shop')

    const scope = all ? 'ทุกเกม' : `${gameIds.length} เกมที่เลือก`
    if (added.length === 0) {
      return { ok: `${scope} นำเข้าไปหมดแล้วก่อนหน้านี้ — ไม่มีแพ็กเกจใหม่ให้เพิ่ม` }
    }
    return {
      ok:
        `นำเข้า ${scope} แล้ว — เพิ่มใหม่ ${added.length} แพ็กเกจ` +
        (markup > 0
          ? ` · บวกกำไร ${markup}% จากต้นทุน (ปัดขึ้นเป็นจำนวนเต็ม)`
          : ' · ราคาขายเท่าทุน ไปตั้งกำไรได้ที่หน้าเกม') +
        (publish
          ? ` · เปิดขายบนเว็บแล้ว ${publishedGames} เกม`
          : ' · ยังไม่เปิดขายบนเว็บ'),
    }
  } catch (err) {
    return { error: friendlyError(err, 'นำเข้าไม่สำเร็จ') }
  }
}

/**
 * อัปเดตแพ็กเกจที่นำเข้าไปแล้วให้ตรงกับข้อมูลล่าสุดของผู้ให้บริการ
 *
 * กฎสำคัญ: **ห้ามทับราคาขายที่ตั้งไว้เอง**
 *  - แพ็กที่ตั้งกำไรเป็น % ไว้ → คิดราคาขายใหม่จากต้นทุนใหม่ กำไรคงเดิม
 *  - แพ็กที่พิมพ์ราคาขายเอง   → ราคาขายไม่ขยับเลย อัปเดตแค่ต้นทุน
 *    (ต้นทุนที่ถูกต้องทำให้กำไรที่แสดงตรงความจริง และกันขายต่ำกว่าทุนโดยไม่รู้ตัว)
 *
 * ไม่แตะ ชื่อ รูป สถานะเปิดขาย สต๊อก หรือลำดับการแสดง — ของพวกนี้ร้านตั้งเอง
 */
export async function refreshImportedAction(formData: FormData): Promise<ActionState> {
  await requireAdmin()
  const providerId = int(formData, 'provider_id')
  if (!providerId) return { error: 'กรุณาเลือกผู้ให้บริการ' }

  try {
    // ดูก่อนว่าต้นทุนของแพ็กไหนเปลี่ยนบ้าง จะได้รายงานให้เห็นว่ากระทบอะไร
    const changes = await q<{ name: string; old_cost: number; new_cost: number }>(
      `select p.name, p.cost_price::float8 as old_cost, c.pack_price::float8 as new_cost
         from products p
         join provider_catalog c
           on c.provider_id = p.provider_id
          and c.game_id = p.provider_game_id
          and c.server_id = p.provider_server_id
          and c.pack_code = p.provider_sku
        where p.provider_id = $1 and p.cost_price is distinct from c.pack_price
        order by abs(c.pack_price - p.cost_price) desc
        limit 5`,
      [providerId]
    )

    const updated = await q<{ id: number }>(
      `update products p
          set cost_price = c.pack_price,
              provider_fields = c.fields,
              provider_variant = c.game_name,
              provider_product_type = coalesce(c.product_type, p.provider_product_type),
              -- ตั้ง % ไว้ = คิดราคาขายใหม่ให้กำไรเท่าเดิม
              -- ตั้งราคาเอง = ไม่แตะราคาขายเด็ดขาด
              sell_price = case when p.markup_percent is not null
                                then ceil(c.pack_price * (1 + p.markup_percent / 100))
                                else p.sell_price end,
              -- ราคาพาร์ทเนอร์คิดใหม่ด้วยหลักเดียวกัน ไม่งั้นต้นทุนขึ้นแล้วราคาพาร์ทเนอร์
              -- ค้างที่ของเดิม กลายเป็นขายต่ำกว่าทุนให้พาร์ทเนอร์โดยไม่รู้ตัว
              partner_price = case when p.partner_markup_percent is not null
                                   then ceil(c.pack_price * (1 + p.partner_markup_percent / 100))
                                   else p.partner_price end
         from provider_catalog c
        where c.provider_id = p.provider_id
          and c.game_id = p.provider_game_id
          and c.server_id = p.provider_server_id
          and c.pack_code = p.provider_sku
          and p.provider_id = $1
          -- ต้องเช็กทุกคอลัมน์ที่คำสั่งนี้เขียน ไม่งั้นแถวที่ต่างกันเฉพาะคอลัมน์
          -- ที่ไม่ได้เช็กจะถูกข้ามไป แล้วกู้ข้อมูลที่หายไม่ได้
          and (p.cost_price is distinct from c.pack_price
               or p.provider_fields is distinct from c.fields
               or p.provider_variant is distinct from c.game_name
               or p.provider_product_type is distinct from c.product_type)
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

    revalidatePath('/storefront')
    revalidatePath('/games')
    revalidatePath('/shop')

    if (updated.length === 0) {
      return { ok: 'ข้อมูลตรงกับผู้ให้บริการอยู่แล้ว — ไม่มีอะไรต้องอัปเดต' }
    }

    const detail = changes
      .map((c) => `${c.name} ${c.old_cost.toLocaleString('th-TH')}→${c.new_cost.toLocaleString('th-TH')}`)
      .join(' · ')

    const warn =
      losing.length > 0
        ? ` ⚠ ขายต่ำกว่าทุน ${losing.length} แพ็ก: ` +
          losing.map((l) => `${l.name} (ทุน ${l.cost_price} ขาย ${l.sell_price})`).join(' · ') +
          ' — ไปแก้ราคาขายด่วน'
        : ''

    return {
      ok:
        `อัปเดต ${updated.length} แพ็กเกจแล้ว — ราคาขายที่ตั้งเองไม่ถูกแตะ ` +
        `ส่วนแพ็กที่ตั้งกำไรเป็น % ไว้คิดราคาใหม่ให้แล้ว` +
        (detail ? ` · ต้นทุนที่เปลี่ยน: ${detail}` : '') +
        warn,
    }
  } catch (err) {
    return { error: friendlyError(err, 'อัปเดตข้อมูลไม่สำเร็จ') }
  }
}
