'use client'

import { useState } from 'react'
import { money } from '@/lib/format'

/**
 * ช่องปรับกำไรในตารางแพ็กเกจ พร้อมราคาขายและกำไรที่คิดให้สดตอนพิมพ์
 *
 * คืนค่าเป็นหลาย <td> ติดกัน เพราะต้องวางในแถวของตารางเดิม
 * ตัวเลขที่ยังไม่ได้กดบันทึกจะเปลี่ยนสีให้เห็น จะได้รู้ว่าอันไหนแก้ค้างไว้
 *
 * ช่องกรอกผูกกับฟอร์มด้านนอกด้วย form="markup-form" เพราะในตารางมีฟอร์มอื่นอยู่แล้ว
 * วางฟอร์มซ้อนกันไม่ได้ตามมาตรฐาน HTML
 */
export function MarkupCells({
  productId,
  productName,
  cost,
  sellPrice,
  markup,
  showMoney,
}: {
  productId: number
  productName: string
  cost: number
  sellPrice: number
  markup: number | null
  /** แสดงคอลัมน์กำไรไหม (เฉพาะผู้ดูแลระบบ) */
  showMoney: boolean
}) {
  const [text, setText] = useState(markup == null ? '' : String(markup))

  const typed = text.trim()
  const pct = Number(typed)
  const usePct = typed !== '' && Number.isFinite(pct) && pct >= 0

  // สูตรเดียวกับที่ฝั่งเซิร์ฟเวอร์ใช้ตอนบันทึก (ปัดขึ้นเป็นจำนวนเต็มบาท)
  // ถ้าคิดคนละแบบ ตัวเลขที่เห็นตอนพิมพ์จะไม่ตรงกับที่บันทึกจริง
  const nextSell = usePct ? Math.ceil(cost * (1 + pct / 100)) : sellPrice
  const nextMargin = nextSell - cost

  const savedText = markup == null ? '' : String(markup)
  const dirty = typed !== savedText.trim()
  const bad = typed !== '' && !usePct

  return (
    <>
      <td className={`text-right font-medium ${dirty ? 'text-warn' : 'text-white'}`}>
        {money(nextSell)}
      </td>
      {showMoney ? (
        <td
          className={`text-right ${
            dirty ? 'text-warn' : nextMargin >= 0 ? 'text-good' : 'text-bad'
          }`}
        >
          {money(nextMargin)}
        </td>
      ) : null}
      <td className="text-right">
        <input
          form="markup-form"
          name={`markup_${productId}`}
          type="number"
          min={0}
          step="0.01"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className={`input w-24 px-2 py-1 text-right text-xs ${
            bad ? 'border-bad' : dirty ? 'border-warn' : ''
          }`}
          placeholder="ตั้งเอง"
          aria-label={`กำไรเปอร์เซ็นต์ของ ${productName}`}
        />
      </td>
    </>
  )
}
