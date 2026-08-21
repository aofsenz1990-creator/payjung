/**
 * ทดสอบตัวตัดรายการซ้ำ — รันด้วย `npm test` (ไม่ต้องมีฐานข้อมูล)
 *
 * ตรรกะนี้พังเมื่อไหร่ = ทั้งก้อนที่ดึงมาบันทึกไม่ได้เลย (Postgres ปฏิเสธทั้งคำสั่ง)
 * หรือแย่กว่านั้นคือสินค้าคนละชิ้นทับกันเงียบ ๆ แล้วราคาทุนเพี้ยน จึงต้องพิสูจน์ได้ว่าถูก
 */
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const src = pathToFileURL(path.resolve('src/lib/catalogDedupe.ts')).href
const { dedupeEntries, dedupeNote } = await import(src)

function entry(over) {
  return {
    gameId: '1',
    gameName: 'เกมทดสอบ',
    serverId: '0',
    serverName: null,
    sku: '10',
    packName: 'แพ็ก 100 เพชร',
    packDesc: '',
    price: 35,
    fields: null,
    productType: 'uid',
    ...over,
  }
}

let pass = 0
function check(name, fn) {
  fn()
  pass++
  console.log('  ✓', name)
}

console.log('ตัดรายการซ้ำ (catalogDedupe)')

check('ไม่มีอะไรซ้ำ = ไม่ตัดอะไรเลย', () => {
  const r = dedupeEntries([entry(), entry({ sku: '11' }), entry({ gameId: '2' })])
  assert.equal(r.entries.length, 3)
  assert.equal(r.duplicates, 0)
  assert.equal(r.collisions, 0)
  assert.equal(dedupeNote(r), null)
})

check('รหัสซ้ำและข้อมูลเหมือนกันเป๊ะ = ตัดทิ้งเงียบ ๆ ได้', () => {
  const r = dedupeEntries([entry(), entry()])
  assert.equal(r.entries.length, 1)
  assert.equal(r.duplicates, 1)
  assert.equal(r.collisions, 0)
  assert.match(dedupeNote(r), /ข้อมูลเหมือนกัน/)
})

check('รหัสเดียวกันแต่คนละชนิดสินค้า = คนละของ ต้องเก็บไว้ทั้งคู่', () => {
  // เคสจริงของ OverTopup: รหัส 4/16 เป็นได้ทั้ง RoV 6,200 คูปอง (uid)
  // และ Steam wallet TH 200 บาท (card) — ถ้าทับกันราคาทุนจะเพี้ยนจาก 4,700 เหลือ 205
  const rov = entry({ gameId: '4', sku: '16', productType: 'uid', packName: 'RoV 6,200 คูปอง', price: 4700 })
  const steam = entry({ gameId: '4', sku: '16', productType: 'card', packName: 'Steam wallet TH 200', price: 205 })
  const r = dedupeEntries([rov, steam])
  assert.equal(r.entries.length, 2)
  assert.equal(r.collisions, 0)
  assert.equal(r.duplicates, 0)
  assert.equal(dedupeNote(r), null)
  assert.deepEqual(r.entries.map((e) => e.price).sort((a, b) => a - b), [205, 4700])
})

check('รหัสและชนิดตรงกันแต่คนละสินค้า = ต้องเตือนว่ามีของหาย', () => {
  const a = entry({ packName: 'เพชร 100', price: 35 })
  const b = entry({ packName: 'เพชร 200', price: 70 })
  const r = dedupeEntries([a, b])
  assert.equal(r.entries.length, 1)
  assert.equal(r.collisions, 1)
  assert.equal(r.entries[0].packName, 'เพชร 200') // เก็บตัวหลังสุด
  assert.match(dedupeNote(r), /คนละแพ็กเกจ/)
})

check('ตัวอย่างในรายงานไม่เกิน 3 คู่ แต่ยอดนับต้องครบ', () => {
  const list = []
  for (let i = 0; i < 10; i++) {
    list.push(entry({ sku: String(i), packName: 'A' + i, price: 1 }))
    list.push(entry({ sku: String(i), packName: 'B' + i, price: 2 }))
  }
  const r = dedupeEntries(list)
  assert.equal(r.collisions, 10)
  assert.equal(r.samples.length, 3)
  assert.equal(r.entries.length, 10)
  assert.match(dedupeNote(r), /10 รายการ/)
})

check('คนละเซิร์ฟเวอร์ = คนละรายการ ห้ามตัด', () => {
  const r = dedupeEntries([entry({ serverId: 'A' }), entry({ serverId: 'B' })])
  assert.equal(r.entries.length, 2)
  assert.equal(r.collisions, 0)
})

check('รหัสที่มีช่องว่างต้องไม่กลายเป็นกุญแจเดียวกัน', () => {
  const r = dedupeEntries([
    entry({ gameId: '1', serverId: '2 3', sku: '4' }),
    entry({ gameId: '1 2', serverId: '3', sku: '4' }),
  ])
  assert.equal(r.entries.length, 2)
  assert.equal(r.collisions, 0)
})

check('ชนิดว่างกับชนิด null ถือเป็นตัวเดียวกัน (เจ้าที่ไม่ได้บอกชนิดมา)', () => {
  const r = dedupeEntries([entry({ productType: null }), entry({ productType: undefined })])
  assert.equal(r.entries.length, 1)
  assert.equal(r.duplicates, 1)
})

check('ช่องกรอกต่างกันทั้งที่รหัสและชนิดตรงกัน = ต้องเตือน', () => {
  const a = entry({ fields: [{ key: 'uid' }] })
  const b = entry({ fields: [{ key: 'uid' }, { key: 'server' }] })
  const r = dedupeEntries([a, b])
  assert.equal(r.collisions, 1)
})

console.log(`\nผ่านทั้งหมด ${pass} ข้อ`)
