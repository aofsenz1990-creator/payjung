'use server'

import { revalidatePath } from 'next/cache'
import { q, q1 } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { BuymError } from '@/lib/providers/24buym'
import { adapterFor, toConfig } from '@/lib/providers/registry'
import { OutOfTime } from '@/lib/providers/http'
import { ProviderError } from '@/lib/providers/types'
import { bool, decimal, friendlyError, int, str } from '@/lib/form'
import {
  applyCatalogToProducts,
  getProvider,
  notifyPriceChange,
  refreshSellingPrices,
  saveCatalog,
} from '@/lib/priceRefresh'
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

  try {
    /**
     * สินค้าที่เพิ่งดึงมาไม่นาน — ส่งไปให้ตัวเชื่อมข้าม จะได้เอาเวลาไปดึงส่วนที่ยังขาด
     * เกินสองชั่วโมงถือว่าเก่าแล้ว ดึงใหม่ทั้งหมดเพื่อให้ราคาตรงกับปลายทาง
     *
     * ข้ามเฉพาะตัวที่ได้ "ช่องกรอกของลูกค้า" มาแล้วเท่านั้น
     * ตัวที่ยังไม่มีต้องดึงใหม่เสมอ ไม่งั้นสินค้าที่เคยดึงตอนโค้ดยังอ่านฟอร์มไม่เป็น
     * จะถูกข้ามตลอดไป แล้วลูกค้าจะเจอแค่ช่องไอดีเกมช่องเดียวไม่มีวันหาย
     */
    const forceAll = bool(formData, 'full')
    const fresh = forceAll
      ? []
      : await q<{ game_id: string }>(
          `select distinct game_id from provider_catalog
            where provider_id = $1
              and synced_at > now() - interval '2 hours'
              and fields is not null`,
          [providerId]
        )
    const have = new Set(fresh.map((r) => r.game_id))

    // จับเวลาแยกสองช่วง (ยิง API กับ บันทึกลงฐานข้อมูล) แล้วรายงานกลับไปด้วย
    // เวลาที่ช้าอยู่ตรงไหนต้องดูออกจากหน้าจอ ไม่ใช่ต้องเดา
    const startedAt = Date.now()

    // ตัวเชื่อมบางเจ้าคืนหมายเหตุมาด้วยว่ามีอะไรที่ยังดึงมาไม่ครบ — ต้องเอาไปบอกคนกด
    const result = await adapter.fetchCatalog(toConfig(provider), { have })
    const fetchMs = Date.now() - startedAt
    const entries = Array.isArray(result) ? result : result.entries
    const note = Array.isArray(result) ? null : result.note
    // ดึงมาไม่ครบ = ห้ามล้างของเดิมทิ้ง ไม่งั้นกดซ้ำเท่าไรก็วนอยู่ที่เดิม ไม่มีวันครบ
    const partial = Array.isArray(result) ? false : Boolean(result.partial)

    if (entries.length === 0) {
      // ไม่ได้อะไรมาเลยเพราะดึงครบไปแล้วตั้งแต่รอบก่อน ไม่ใช่ความผิดพลาด
      if (partial) {
        revalidatePath('/storefront')
        return { ok: `ไม่มีรายการใหม่ในรอบนี้${note ? ` · ⚠️ ${note}` : ''}` }
      }
      return { error: 'ปลายทางไม่ได้ส่งรายการสินค้ามาเลย' }
    }

    /**
     * เขียนทับของเดิมก่อน แล้วค่อยลบของที่ปลายทางไม่มีแล้วทีหลัง
     *
     * เดิมลบทั้งหมดก่อนแล้วค่อยใส่ชุดใหม่ ซึ่งถ้าฟังก์ชันถูกตัดกลางคัน (เจ้าที่รายการใหญ่มาก
     * ใช้เวลานานจนเสี่ยง) จะเหลือรายการแหว่งหรือไม่เหลือเลย ลูกค้าจะหาของไม่เจอทันที
     * แบบนี้ระหว่างบันทึกยังมีของเดิมให้ใช้ตลอด และถ้าโดนตัดกลางคันก็แค่ "ยังไม่ทันอัปเดต"
     */
    const clock = await q1<{ now: string }>('select now() as now')
    const writeFrom = clock?.now ?? null

    const saved = await saveCatalog(providerId, entries)

    // ดึงมาครบทั้งร้านแล้ว = อะไรที่ไม่ได้ถูกเขียนทับในรอบนี้ แปลว่าปลายทางเลิกขายแล้ว ลบทิ้งได้
    // ดึงมาไม่ครบ ห้ามลบเด็ดขาด เพราะของที่ยังไม่ได้ดึงในรอบนี้ก็เข้าเงื่อนไขนี้เหมือนกัน
    if (!partial && writeFrom) {
      await q('delete from provider_catalog where provider_id = $1 and synced_at < $2', [
        providerId,
        writeFrom,
      ])
    }

    // รายงานจากของที่เก็บไว้จริงทั้งหมด ไม่ใช่แค่รอบนี้ — ตอนกดซ้ำสะสมจะได้เห็นว่าคืบไปถึงไหน
    const stored = await q1<{ games: number; packs: number }>(
      `select count(distinct game_id)::int as games, count(*)::int as packs
         from provider_catalog where provider_id = $1`,
      [providerId]
    )
    const games = stored?.games ?? new Set(entries.map((e) => e.gameId)).size
    // หมายเหตุจากตัวเชื่อม + เรื่องรายการซ้ำที่ถูกตัดออก ต้องบอกทั้งคู่
    const notes = [note, saved.note].filter(Boolean).join(' · ')
    revalidatePath('/storefront')
    return {
      ok:
        `ดึงรายการสำเร็จ — รอบนี้ได้ ${saved.saved} รายการ · ` +
        `รวมที่เก็บไว้ ${games} เกม ${stored?.packs ?? saved.saved} รายการสินค้า · ` +
        `ใช้เวลา ${(fetchMs / 1000).toFixed(1)} วิ (ยิง API) + ` +
        `${((Date.now() - startedAt - fetchMs) / 1000).toFixed(1)} วิ (บันทึก)` +
        (notes ? ` · ⚠️ ${notes}` : ''),
    }
  } catch (err) {
    // หมดเวลาของรอบ ไม่ใช่ความผิดพลาด — บอกให้กดซ้ำเพื่อไปต่อ
    if (err instanceof OutOfTime) {
      return { error: 'ดึงไม่ทันในเวลาที่มี — กดดึงซ้ำอีกครั้ง ระบบจะไปต่อจากที่ค้างไว้' }
    }
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
 * ดึงราคาเฉพาะสินค้าที่ร้าน "เปิดขายอยู่จริง" แล้วอัปเดตให้ในปุ่มเดียว
 *
 * ตัวงานจริงอยู่ที่ lib/priceRefresh.ts เพราะรอบอัตโนมัติประจำวัน
 * (/api/refresh-prices) ต้องใช้ตัวเดียวกันเป๊ะ ๆ ไม่งั้นกดเองกับปล่อยให้ทำเองจะได้ผลไม่ตรงกัน
 */
export async function refreshSellingPricesAction(formData: FormData): Promise<ActionState> {
  await requireAdmin()
  const providerId = int(formData, 'provider_id')
  if (!providerId) return { error: 'กรุณาเลือกผู้ให้บริการ' }

  const provider = await getProvider(providerId)
  if (!provider) return { error: 'ไม่พบผู้ให้บริการนี้' }

  const result = await refreshSellingPrices(provider)
  if (!result.ok) return { error: result.error ?? 'ดึงราคาไม่สำเร็จ' }

  revalidatePath('/storefront')
  revalidatePath('/games')
  revalidatePath('/shop')

  const applied = result.applied!
  const head =
    `ดึงราคาเฉพาะที่เปิดขายของ "${result.provider}" แล้ว — ` +
    `${result.games} เกม ${result.packs} แพ็กเกจ · ` +
    `ใช้เวลา ${(result.fetchMs / 1000).toFixed(1)} + ${(result.saveMs / 1000).toFixed(1)} วินาที`
  const tail = result.note ? ` · ⚠️ ${result.note}` : ''

  if (applied.updated === 0) {
    return { ok: `${head} · ราคาตรงกับปลายทางอยู่แล้ว ไม่มีอะไรเปลี่ยน${tail}` }
  }

  // ราคาทุนเปลี่ยน = เรื่องเงิน ต้องแจ้งเข้า LINE ด้วย ไม่ใช่ขึ้นแค่บนหน้าจอคนที่กด
  void notifyPriceChange(result.provider, applied)

  return { ok: `${head} · ${applied.summary}${tail}` }
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

  const row = await q1<{ name: string }>('select name from api_providers where id = $1', [
    providerId,
  ])
  const providerName = row?.name ?? 'ผู้ให้บริการ'

  try {
    const applied = await applyCatalogToProducts(providerId)

    revalidatePath('/storefront')
    revalidatePath('/games')
    revalidatePath('/shop')

    if (applied.updated === 0) {
      return { ok: 'ข้อมูลตรงกับผู้ให้บริการอยู่แล้ว — ไม่มีอะไรต้องอัปเดต' }
    }

    // ราคาทุนเปลี่ยน = เรื่องเงิน ต้องแจ้งเข้า LINE ด้วย ไม่ใช่ขึ้นแค่บนหน้าจอคนที่กด
    void notifyPriceChange(providerName, applied)

    return { ok: applied.summary }
  } catch (err) {
    return { error: friendlyError(err, 'อัปเดตข้อมูลไม่สำเร็จ') }
  }
}
