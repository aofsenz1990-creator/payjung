/**
 * ตัดรายการสินค้าที่รหัสซ้ำกันออกก่อนบันทึกลงฐานข้อมูล
 *
 * แยกเป็นไฟล์ที่ไม่นำเข้าอะไรเลย เพื่อให้ทดสอบด้วย node ตรง ๆ ได้โดยไม่ต้องมีฐานข้อมูล
 * (ตรรกะตรงนี้พังเมื่อไหร่ = ทั้งก้อนที่ดึงมาบันทึกไม่ได้เลย จึงต้องพิสูจน์ได้ว่าถูก)
 */

export type CatalogEntryRow = {
  gameId: string
  gameName: string
  serverId: string
  serverName: string | null
  sku: string
  packName: string
  packDesc: string
  price: number
  fields?: unknown
  productType?: string | null
}

/* ------------------------------- ตัดรายการซ้ำ ------------------------------- */

/** กุญแจที่ต้องไม่ซ้ำกันในตาราง provider_catalog */
function keyOf(e: CatalogEntryRow) {
  // คั่นด้วยอักขระที่ไม่มีวันโผล่ในรหัสจริง ไม่งั้นรหัสที่มีช่องว่างอาจกลายเป็นกุญแจเดียวกัน
  return `${e.gameId}\u0000${e.serverId}\u0000${e.sku}`
}

/** สองรายการนี้คือ "ของชิ้นเดียวกันที่ส่งมาซ้ำ" หรือ "คนละชิ้นที่รหัสดันชนกัน" */
function sameContent(a: CatalogEntryRow, b: CatalogEntryRow) {
  return (
    a.gameName === b.gameName &&
    a.serverName === b.serverName &&
    a.packName === b.packName &&
    a.packDesc === b.packDesc &&
    a.price === b.price &&
    (a.productType ?? null) === (b.productType ?? null) &&
    JSON.stringify(a.fields ?? null) === JSON.stringify(b.fields ?? null)
  )
}

export type DedupeResult = {
  entries: CatalogEntryRow[]
  /** จำนวนที่ตัดออกเพราะซ้ำแบบข้อมูลเหมือนกันเป๊ะ (ไม่มีอะไรเสียหาย) */
  duplicates: number
  /** จำนวนที่รหัสชนกันทั้งที่เป็นคนละสินค้า — อันนี้แปลว่ามีของหาย ต้องบอกให้รู้ */
  collisions: number
  /** ตัวอย่างคู่ที่ชนกัน ไว้ให้คนหลังร้านเอาไปแจ้งผู้ให้บริการ */
  samples: string[]
}

/**
 * ตัดรายการที่มีรหัสซ้ำกันออกก่อนบันทึก
 *
 * Postgres ปฏิเสธคำสั่ง insert ... on conflict ที่มีสองแถวชี้ไปแถวเดียวกัน
 * ("ON CONFLICT DO UPDATE command cannot affect row a second time")
 * ซึ่งทำให้ทั้งก้อน 800 รายการล้มพร้อมกัน ทั้งที่ซ้ำอยู่แค่คู่เดียว
 *
 * เก็บ "ตัวหลังสุด" ไว้ เพราะรายการที่ปลายทางส่งมาทีหลังมักเป็นตัวที่ใหม่กว่า
 * และ **ต้องรายงานเสมอว่าตัดอะไรออกไป** — ถ้ารหัสชนกันทั้งที่เป็นคนละสินค้า
 * แปลว่าของบางชิ้นหายไปจากระบบเงียบ ๆ ซึ่งอันตรายกว่าการดึงไม่สำเร็จเสียอีก
 */
export function dedupeEntries(entries: CatalogEntryRow[]): DedupeResult {
  const byKey = new Map<string, CatalogEntryRow>()
  const samples: string[] = []
  let duplicates = 0
  let collisions = 0

  for (const e of entries) {
    const key = keyOf(e)
    const prev = byKey.get(key)
    if (prev) {
      if (sameContent(prev, e)) {
        duplicates++
      } else {
        collisions++
        if (samples.length < 3) {
          const kinds =
            (prev.productType ?? '') !== (e.productType ?? '')
              ? ` [ชนิด ${prev.productType ?? 'ไม่ระบุ'} ↔ ${e.productType ?? 'ไม่ระบุ'}]`
              : ''
          samples.push(
            `รหัส ${e.gameId}/${e.sku}: "${prev.gameName} — ${prev.packName}" ` +
              `ชนกับ "${e.gameName} — ${e.packName}"${kinds}`
          )
        }
      }
    }
    byKey.set(key, e)
  }

  return { entries: [...byKey.values()], duplicates, collisions, samples }
}

/** ข้อความเตือนเรื่องรายการซ้ำ — คืน null ถ้าไม่มีอะไรต้องบอก */
export function dedupeNote(d: DedupeResult): string | null {
  const parts: string[] = []
  if (d.collisions > 0) {
    parts.push(
      `ปลายทางส่งรหัสสินค้าซ้ำที่เป็นคนละแพ็กเกจมา ${d.collisions} รายการ ` +
        `ระบบเก็บได้แค่ตัวหลังสุด (ของบางชิ้นจึงหายไป) — ${d.samples.join(' · ')}`
    )
  }
  if (d.duplicates > 0) {
    parts.push(`ตัดรายการซ้ำที่ข้อมูลเหมือนกันออก ${d.duplicates} รายการ`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

