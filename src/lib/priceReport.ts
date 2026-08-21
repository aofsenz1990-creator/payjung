import type { DailyRunResult } from './priceRefresh'

/**
 * เขียนรายงานรอบดึงราคาประจำวันเป็นข้อความสำหรับส่งเข้า LINE
 *
 * อยู่แยกไฟล์และไม่นำเข้าอะไรที่แตะฐานข้อมูลหรือเครือข่ายเลย
 * เพื่อให้ทดสอบข้อความที่ออกมาได้จริงด้วย node ตรง ๆ —
 * รายงานเรื่องเงินที่เขียนผิด อันตรายพอ ๆ กับตัวเลขที่คำนวณผิด
 */

/** จำนวนบรรทัดราคาที่ยอมให้ลงรายละเอียดต่อผู้ให้บริการหนึ่งเจ้า */
const MAX_PRICE_LINES = 15

function baht(n: number) {
  return n.toLocaleString('th-TH', { maximumFractionDigits: 2 })
}

/**
 * เขียนรายงานรอบอัตโนมัติเป็นข้อความเดียวสำหรับส่งเข้า LINE
 *
 * แยกเป็นฟังก์ชันบริสุทธิ์ (ไม่แตะฐานข้อมูลและไม่ยิงเน็ต) เพื่อให้ทดสอบข้อความที่ออกมาได้จริง
 * ข้อความที่ผิดพลาดในรายงานเรื่องเงิน อันตรายพอ ๆ กับตัวเลขที่ผิด
 *
 * กติกา: **ส่งทุกวันแม้ไม่มีอะไรเปลี่ยน** เจ้าของร้านขอไว้ให้เห็นว่าระบบยังทำงานอยู่
 * วันที่เงียบก็ต้องมีข้อความบอกว่า "ตรวจแล้ว ราคาตรงหมด" ไม่ใช่ไม่ส่งอะไรเลย
 * ซึ่งแยกไม่ออกจากกรณีที่ระบบตายไปเฉย ๆ
 */
export function buildRunReport(run: DailyRunResult, opts?: { chained?: boolean }): string {
  const ok = run.results.filter((r) => r.ok)
  const bad = run.results.filter((r) => !r.ok)
  const totalChanged = ok.reduce((n, r) => n + (r.applied?.updated ?? 0), 0)

  const lines: string[] = [
    '🕒 รายงานราคาทุนประจำวัน',
    `สำเร็จ ${ok.length}/${run.total} เจ้า · อัปเดต ${totalChanged} แพ็กเกจ`,
  ]

  for (const r of run.results) {
    lines.push('')

    if (!r.ok) {
      lines.push(`❌ ${r.provider} — ดึงไม่สำเร็จ`)
      lines.push(`   ${r.error}`)
      continue
    }

    const applied = r.applied
    const n = applied?.updated ?? 0
    const speed = `${((r.fetchMs + r.saveMs) / 1000).toFixed(1)} วิ`
    lines.push(
      n > 0
        ? `✅ ${r.provider} — อัปเดต ${n} แพ็กเกจ (${r.games} เกม · ${speed})`
        : `✔️ ${r.provider} — ราคาตรงกับปลายทางอยู่แล้ว (${r.games} เกม · ${speed})`
    )

    // ราคาที่เปลี่ยน จัดกลุ่มตามเกม เพราะเจ้าของร้านคิดเป็น "เกม" ไม่ใช่ "แพ็กเกจ"
    const changes = applied?.changes ?? []
    if (changes.length > 0) {
      const byGame = new Map<string, typeof changes>()
      for (const c of changes.slice(0, MAX_PRICE_LINES)) {
        const list = byGame.get(c.game) ?? []
        list.push(c)
        byGame.set(c.game, list)
      }
      for (const [game, list] of byGame) {
        lines.push(`   📦 ${game}`)
        for (const c of list) {
          const arrow = c.new_cost > c.old_cost ? '▲' : '▼'
          lines.push(`   ${arrow} ${c.name}: ${baht(c.old_cost)} → ${baht(c.new_cost)} บาท`)
        }
      }
      if (changes.length > MAX_PRICE_LINES) {
        lines.push(`   … และอีก ${changes.length - MAX_PRICE_LINES} แพ็กเกจ (ดูทั้งหมดในหลังร้าน)`)
      }
      if (n > changes.length) {
        lines.push(`   (อีก ${n - changes.length} แพ็กเกจอัปเดตช่องกรอก/ชื่อ ราคาทุนไม่เปลี่ยน)`)
      }
    }

    if ((applied?.losing.length ?? 0) > 0) {
      lines.push(`   ⚠️ ขายต่ำกว่าทุน ${applied!.losing.length} แพ็ก ต้องรีบแก้ราคาขาย:`)
      for (const l of applied!.losing) {
        lines.push(`   • ${l.name} — ทุน ${baht(l.cost_price)} ขาย ${baht(l.sell_price)}`)
      }
    }

    if ((applied?.repaired.length ?? 0) > 0) {
      lines.push(`   🔧 ซ่อมชนิดสินค้าที่จับคู่ผิดตัว ${applied!.repaired.length} แพ็ก`)
      for (const x of applied!.repaired.slice(0, 5)) {
        lines.push(`   • ${x.name} → ${x.product_type || 'ไม่ระบุ'}`)
      }
      lines.push('   ตรวจราคาขายของแพ็กพวกนี้ด้วย เพราะทุนที่เคยผิดอาจดันราคาขายเพี้ยนไปแล้ว')
    }

    for (const x of applied?.suspect ?? []) {
      lines.push(`   ❗ ${x.name} อาจจับคู่ข้ามเกม — เกมเรา "${x.our_game}" ไปคว้าของ "${x.their_game}"`)
    }

    if ((applied?.unmatched ?? 0) > 0) {
      lines.push(
        `   ⚠️ อีก ${applied!.unmatched} แพ็กหาคู่ในรายการปลายทางไม่เจอ ราคาทุนค้างของเก่า`
      )
    }

    if (r.note) lines.push(`   ℹ️ ${r.note}`)
  }

  if (run.pendingNames.length > 0) {
    lines.push('')
    lines.push(
      opts?.chained
        ? `⏳ ยังไม่ได้ทำ: ${run.pendingNames.join(', ')} — ระบบจุดรอบถัดไปให้ทำต่อแล้ว`
        : `❗ ยังไม่ได้อัปเดต: ${run.pendingNames.join(', ')} — เวลาหมดและต่อรอบถัดไปไม่ได้ ` +
            `ต้องเข้าหลังร้านกดปุ่ม "ดึงราคาเฉพาะที่เปิดขาย" ของเจ้านี้เอง`
    )
  }

  if (totalChanged > 0) {
    lines.push('')
    lines.push('อย่าลืมกด "อัปเดตราคาขึ้นหน้าเว็บ" ให้ลูกค้าเห็นราคาใหม่')
  }

  if (bad.length === 0 && run.pending.length === 0 && totalChanged === 0) {
    lines.push('')
    lines.push('ไม่มีอะไรต้องทำ ระบบตรวจครบทุกเจ้าแล้ว')
  }

  return lines.join('\n')
}

