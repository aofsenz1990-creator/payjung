'use server'

import { revalidatePath } from 'next/cache'
import { q, q1 } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { BuymError, getProducts } from '@/lib/providers/24buym'
import { decimal, friendlyError, int, str } from '@/lib/form'
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
    name: string
    base_url: string | null
    api_key: string | null
    kind: string
  }>('select name, base_url, api_key, kind from api_providers where id = $1', [providerId])

  if (!provider) return { error: 'ไม่พบผู้ให้บริการนี้' }
  if (!provider.api_key) return { error: `"${provider.name}" ยังไม่ได้ตั้งคีย์` }
  if (provider.kind !== '24buym') {
    return { error: `ยังรองรับการดึงรายการอัตโนมัติเฉพาะ 24BUYM (เจ้านี้เป็นชนิด "${provider.kind}")` }
  }

  try {
    const result = await getProducts(provider.base_url, provider.api_key)
    if (!result.success) return { error: 'ปลายทางตอบกลับว่าไม่สำเร็จ' }

    // แผ่รายการเกม × เซิร์ฟเวอร์ × แพ็กเกจ ให้เป็นแถวเดียวต่อสินค้าหนึ่งชิ้น
    type Row = [number, string, string, string, string | null, string, string, string, number]
    const rows: Row[] = []
    for (const game of result.products ?? []) {
      const servers =
        game.servers?.length > 0 ? game.servers : [{ server_id: '0', server_name: '' }]
      for (const server of servers) {
        for (const pack of game.packages ?? []) {
          rows.push([
            providerId,
            String(game.game_id),
            game.game_name,
            String(server.server_id ?? '0'),
            server.server_name || null,
            String(pack.pack_code),
            pack.pack_name,
            pack.pack_desc ?? '',
            Number(pack.pack_price) || 0,
          ])
        }
      }
    }

    if (rows.length === 0) return { error: 'ปลายทางไม่ได้ส่งรายการสินค้ามาเลย' }

    // ล้างของเก่าของเจ้านี้แล้วใส่ชุดใหม่ทั้งหมด จะได้ตรงกับปลายทางเสมอ
    await q('delete from provider_catalog where provider_id = $1', [providerId])

    const CHUNK = 400
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK)
      const values = chunk
        .map((_, n) => {
          const b = n * 9
          return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9})`
        })
        .join(',')
      await q(
        `insert into provider_catalog
           (provider_id, game_id, game_name, server_id, server_name, pack_code, pack_name, pack_desc, pack_price)
         values ${values}
         on conflict (provider_id, game_id, server_id, pack_code) do nothing`,
        chunk.flat()
      )
    }

    const games = new Set(rows.map((r) => r[1])).size
    revalidatePath('/storefront')
    return { ok: `ดึงรายการสำเร็จ — ${games} เกม รวม ${rows.length} รายการสินค้า` }
  } catch (err) {
    if (err instanceof BuymError) return { error: err.message }
    return { error: friendlyError(err, 'ดึงรายการสินค้าไม่สำเร็จ') }
  }
}

/**
 * นำเข้าเกมหนึ่งเกมจากรายการที่ดึงมา สร้างเกมและแพ็กเกจในระบบให้อัตโนมัติ
 * ตั้งราคาขายเท่าทุนไว้ก่อน ให้ร้านไปปรับกำไรเองทีหลัง
 */
export async function importGameAction(formData: FormData): Promise<ActionState> {
  await requireAdmin()
  const providerId = int(formData, 'provider_id')
  const providerGameId = str(formData, 'game_id')
  const markup = decimal(formData, 'markup', 0)

  if (!providerId || !providerGameId) return { error: 'ข้อมูลไม่ครบ' }

  try {
    const packs = await q<{
      game_name: string
      server_id: string
      server_name: string | null
      pack_code: string
      pack_name: string
      pack_price: number
    }>(
      `select game_name, server_id, server_name, pack_code, pack_name,
              pack_price::float8 as pack_price
         from provider_catalog
        where provider_id = $1 and game_id = $2
        order by server_id, pack_price`,
      [providerId, providerGameId]
    )
    if (packs.length === 0) return { error: 'ไม่พบรายการของเกมนี้ ลองกดดึงรายการใหม่' }

    const gameName = packs[0].game_name

    // มีเกมชื่อนี้อยู่แล้วก็ใช้ตัวเดิม ไม่สร้างซ้ำ
    const existing = await q1<{ id: number }>(
      'select id from games where lower(name) = lower($1) limit 1',
      [gameName]
    )
    let gameId = existing?.id
    if (!gameId) {
      const created = await q<{ id: number }>(
        'insert into games (name, publisher) values ($1, $2) returning id',
        [gameName, '24BUYM']
      )
      gameId = created[0].id
    }

    let added = 0
    let skipped = 0
    for (const p of packs) {
      const label =
        p.server_name && p.server_id !== '0' ? `${p.pack_name} (${p.server_name})` : p.pack_name

      // ข้ามถ้าเคยนำเข้าแพ็กเกจนี้ไปแล้ว ดูจากรหัสฝั่งผู้ให้บริการ
      const dup = await q1<{ id: number }>(
        `select id from products
          where provider_id = $1 and provider_game_id = $2
            and provider_server_id = $3 and provider_sku = $4 limit 1`,
        [providerId, providerGameId, p.server_id, p.pack_code]
      )
      if (dup) {
        skipped++
        continue
      }

      await q(
        `insert into products
           (game_id, name, cost_price, sell_price, is_active, sort_order,
            provider_id, provider_game_id, provider_server_id, provider_sku)
         values ($1, $2, $3, $4, true, $5, $6, $7, $8, $9)`,
        [
          gameId,
          label,
          p.pack_price,
          +(p.pack_price + markup).toFixed(2),
          Math.round(p.pack_price),
          providerId,
          providerGameId,
          p.server_id,
          p.pack_code,
        ]
      )
      added++
    }

    revalidatePath('/storefront')
    revalidatePath('/games')
    return {
      ok:
        `นำเข้า "${gameName}" แล้ว — เพิ่มใหม่ ${added} แพ็กเกจ` +
        (skipped > 0 ? ` (ข้ามที่มีอยู่แล้ว ${skipped})` : '') +
        (markup > 0 ? ` · บวกกำไรแพ็กละ ${markup} บาท` : ' · ราคาขายเท่าทุน ไปปรับกำไรที่หน้าเกมได้'),
    }
  } catch (err) {
    return { error: friendlyError(err, 'นำเข้าไม่สำเร็จ') }
  }
}
