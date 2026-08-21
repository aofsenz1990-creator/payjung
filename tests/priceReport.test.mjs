/**
 * ทดสอบข้อความรายงานที่ส่งเข้า LINE — รันด้วย `npm test` (ไม่ต้องมีฐานข้อมูล)
 *
 * รายงานเรื่องเงินที่เขียนผิดหรือหายไปเงียบ ๆ อันตรายพอ ๆ กับตัวเลขที่คำนวณผิด
 */
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const { buildRunReport } = await import(
  pathToFileURL(path.resolve('src/lib/priceReport.ts')).href
)

function applied(over = {}) {
  return {
    updated: 0,
    changes: [],
    losing: [],
    repaired: [],
    unmatched: 0,
    suspect: [],
    summary: '',
    ...over,
  }
}

function result(over = {}) {
  return {
    provider: 'OVER',
    ok: true,
    games: 24,
    packs: 435,
    fetchMs: 600,
    saveMs: 400,
    applied: applied(),
    note: null,
    ...over,
  }
}

function run(over = {}) {
  const results = over.results ?? [result()]
  return { results, pending: [], pendingNames: [], total: results.length, ...over }
}

let pass = 0
function check(name, fn) {
  fn()
  pass++
  console.log('  ✓', name)
}

console.log('รายงานเข้า LINE (priceReport)')

check('วันที่ไม่มีอะไรเปลี่ยน ก็ต้องมีรายงาน ไม่ใช่เงียบหาย', () => {
  const text = buildRunReport(run())
  assert.match(text, /รายงานราคาทุนประจำวัน/)
  assert.match(text, /สำเร็จ 1\/1 เจ้า/)
  assert.match(text, /ราคาตรงกับปลายทางอยู่แล้ว/)
  assert.match(text, /ไม่มีอะไรต้องทำ/)
})

check('บอกทีละเจ้า และบอกว่าเกมไหนราคาเปลี่ยนเท่าไร', () => {
  const text = buildRunReport(
    run({
      results: [
        result({
          provider: 'OVER',
          applied: applied({
            updated: 2,
            changes: [
              { game: 'RoV Mobile', name: '6,200 คูปอง', old_cost: 205, new_cost: 4700 },
              { game: 'Free Fire', name: '520 เพชร', old_cost: 100, new_cost: 95 },
            ],
          }),
        }),
        result({ provider: 'JCR-SHOP', games: 29 }),
      ],
    })
  )
  assert.match(text, /✅ OVER — อัปเดต 2 แพ็กเกจ \(24 เกม/)
  assert.match(text, /📦 RoV Mobile/)
  assert.match(text, /▲ 6,200 คูปอง: 205 → 4,700 บาท/)
  assert.match(text, /📦 Free Fire/)
  assert.match(text, /▼ 520 เพชร: 100 → 95 บาท/)
  assert.match(text, /✔️ JCR-SHOP/)
  assert.match(text, /อัปเดตราคาขึ้นหน้าเว็บ/)
})

check('เจ้าที่ล้มเหลวต้องขึ้นพร้อมเหตุผล ไม่ใช่แค่หายไปจากรายงาน', () => {
  const text = buildRunReport(
    run({ results: [result({ ok: false, error: 'API Key ไม่ถูกต้อง', applied: undefined })] })
  )
  assert.match(text, /❌ OVER — ดึงไม่สำเร็จ/)
  assert.match(text, /API Key ไม่ถูกต้อง/)
  assert.doesNotMatch(text, /ไม่มีอะไรต้องทำ/)
})

check('ขายต่ำกว่าทุนต้องเด้งขึ้นมาเสมอ', () => {
  const text = buildRunReport(
    run({
      results: [
        result({
          applied: applied({
            updated: 1,
            losing: [{ name: 'เพชร 100', cost_price: 120, sell_price: 99 }],
          }),
        }),
      ],
    })
  )
  assert.match(text, /ขายต่ำกว่าทุน 1 แพ็ก/)
  assert.match(text, /เพชร 100 — ทุน 120 ขาย 99/)
})

check('การซ่อมชนิดสินค้าและของที่น่าสงสัยต้องรายงาน', () => {
  const text = buildRunReport(
    run({
      results: [
        result({
          applied: applied({
            repaired: [{ name: 'RoV 6,200 คูปอง', product_type: 'uid' }],
            suspect: [{ name: 'แพ็กลึกลับ', our_game: 'RoV', their_game: 'Steam wallet TH' }],
            unmatched: 3,
          }),
        }),
      ],
    })
  )
  assert.match(text, /🔧 ซ่อมชนิดสินค้าที่จับคู่ผิดตัว 1 แพ็ก/)
  assert.match(text, /RoV 6,200 คูปอง → uid/)
  assert.match(text, /❗ แพ็กลึกลับ อาจจับคู่ข้ามเกม/)
  assert.match(text, /อีก 3 แพ็กหาคู่ในรายการปลายทางไม่เจอ/)
})

check('ราคาเปลี่ยนเยอะเกินไป ต้องตัดแล้วบอกว่าเหลืออีกเท่าไร', () => {
  const changes = Array.from({ length: 40 }, (_, i) => ({
    game: 'เกม ' + i,
    name: 'แพ็ก ' + i,
    old_cost: 100,
    new_cost: 110,
  }))
  const text = buildRunReport(run({ results: [result({ applied: applied({ updated: 40, changes }) })] }))
  assert.match(text, /… และอีก 25 แพ็กเกจ/)
  assert.ok(text.length < 4900, 'ต้องไม่ยาวเกินเพดานข้อความของ LINE')
})

check('ทำไม่ครบแล้วต่อรอบถัดไปได้ กับต่อไม่ได้ ต้องพูดคนละแบบ', () => {
  const base = { results: [result()], pending: [2], pendingNames: ['JCR-SHOP'], total: 2 }
  assert.match(buildRunReport(base, { chained: true }), /จุดรอบถัดไปให้ทำต่อแล้ว/)
  const stuck = buildRunReport(base, { chained: false })
  assert.match(stuck, /❗ ยังไม่ได้อัปเดต: JCR-SHOP/)
  assert.match(stuck, /ต้องเข้าหลังร้านกดปุ่ม/)
})

check('หมายเหตุจากผู้ให้บริการต้องติดไปด้วย', () => {
  const text = buildRunReport(run({ results: [result({ note: 'ข้าม 13 แพ็กเกจที่ต้องแนบรูป' })] }))
  assert.match(text, /ℹ️ ข้าม 13 แพ็กเกจที่ต้องแนบรูป/)
})

console.log(`\nผ่านทั้งหมด ${pass} ข้อ`)
