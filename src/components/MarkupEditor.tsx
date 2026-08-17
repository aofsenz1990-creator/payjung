'use client'

import { createContext, useContext, useMemo, useState } from 'react'
import { ActionForm, SubmitButton, type ActionState } from '@/components/ActionForm'
import { money } from '@/lib/format'

/**
 * ตัวแก้กำไรของทั้งเกมในที่เดียว
 *
 * ใส่ % ทีเดียวให้ขึ้นทุกช่องก่อน แล้วค่อยแก้ทีละช่องที่อยากให้ต่าง แล้วกดบันทึกครั้งเดียว
 * ทำแบบนี้เพราะของเดิมแยกเป็นสองกลไก (ปุ่มตั้งทั้งเกมที่บันทึกทันที กับช่องในตาราง)
 * ทำให้สับสนว่าอันไหนทับอันไหน และเผลอล้างค่าของแถวที่ไม่ได้ตั้งใจแก้
 *
 * ตอนนี้ทุกอย่างเป็นแค่การพิมพ์บนหน้าจอ ยังไม่แตะฐานข้อมูลจนกว่าจะกดบันทึก
 * เห็นผลก่อนตัดสินใจได้ทั้งหมด
 */

type MarkupItem = { id: number; markup: number | null; partnerMarkup: number | null }

type Ctx = {
  /** ค่าที่กำลังพิมพ์อยู่บนหน้าจอ */
  values: Record<number, string>
  /** ค่าที่บันทึกไว้จริงในฐานข้อมูล ใช้เทียบว่าแถวไหนถูกแก้ */
  saved: Record<number, string>
  set: (id: number, value: string) => void
  /** ชุดเดียวกันแต่ของราคาพาร์ทเนอร์ */
  partnerValues: Record<number, string>
  partnerSaved: Record<number, string>
  setPartner: (id: number, value: string) => void
}

const MarkupCtx = createContext<Ctx | null>(null)

function textOf(markup: number | null) {
  return markup == null ? '' : String(markup)
}

export function MarkupProvider({
  items,
  children,
}: {
  items: MarkupItem[]
  children: React.ReactNode
}) {
  const saved = useMemo(() => {
    const out: Record<number, string> = {}
    for (const it of items) out[it.id] = textOf(it.markup)
    return out
  }, [items])

  const partnerSaved = useMemo(() => {
    const out: Record<number, string> = {}
    for (const it of items) out[it.id] = textOf(it.partnerMarkup)
    return out
  }, [items])

  const [values, setValues] = useState<Record<number, string>>(saved)
  const [partnerValues, setPartnerValues] = useState<Record<number, string>>(partnerSaved)

  const ctx: Ctx = {
    values,
    saved,
    set: (id, value) => setValues((v) => ({ ...v, [id]: value })),
    partnerValues,
    partnerSaved,
    setPartner: (id, value) => setPartnerValues((v) => ({ ...v, [id]: value })),
  }

  return <MarkupCtx.Provider value={ctx}>{children}</MarkupCtx.Provider>
}

/** เผื่อกรณีที่คอมโพเนนต์ถูกใช้นอก Provider จะได้ไม่ล้มทั้งหน้า */
function useMarkup() {
  const ctx = useContext(MarkupCtx)
  if (!ctx) throw new Error('ต้องใช้ภายใน MarkupProvider')
  return ctx
}

/**
 * แถบด้านบน — ใส่ % ให้ทุกแพ็กทีเดียว และปุ่มบันทึก
 * การเติมทุกช่องเป็นแค่การกรอกให้บนหน้าจอ ยังไม่บันทึกจนกว่าจะกดปุ่มบันทึก
 */
export function MarkupBulkBar({
  gameId,
  action,
}: {
  gameId: number
  action: (formData: FormData) => Promise<ActionState>
}) {
  const { values, saved, set, partnerValues, partnerSaved, setPartner } = useMarkup()
  const [bulk, setBulk] = useState('')
  const [partnerBulk, setPartnerBulk] = useState('')

  const ids = Object.keys(saved).map(Number)
  const total = ids.length
  const autoCount = ids.filter((id) => (values[id] ?? '').trim() !== '').length
  const changed =
    ids.filter((id) => (values[id] ?? '').trim() !== (saved[id] ?? '').trim()).length +
    ids.filter((id) => (partnerValues[id] ?? '').trim() !== (partnerSaved[id] ?? '').trim()).length
  const partnerCount = ids.filter((id) => (partnerValues[id] ?? '').trim() !== '').length

  const fillAll = (value: string) => {
    for (const id of ids) set(id, value)
  }
  const fillAllPartner = (value: string) => {
    for (const id of ids) setPartner(id, value)
  }

  return (
    <ActionForm id="markup-form" action={action} className="mb-4">
      <input type="hidden" name="game_id" value={gameId} />

      <div className="rounded-xl border border-brand-500/30 bg-brand-500/10 p-3">
        <p className="mb-2 text-sm font-medium text-slate-100">💰 ตั้งกำไรของเกมนี้</p>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            min={0}
            step="0.01"
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
            className="input w-28"
            placeholder="เช่น 5"
            aria-label="เปอร์เซ็นต์กำไรที่จะใส่ให้ทุกแพ็ก"
          />
          <span className="text-sm text-mute">%</span>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => fillAll(bulk.trim())}
            disabled={bulk.trim() === ''}
          >
            ใส่ให้ทุกแพ็ก
          </button>
          <button type="button" className="btn-ghost" onClick={() => fillAll('')}>
            ล้างทุกช่อง
          </button>

          <span className="ml-auto flex items-center gap-2">
            {changed > 0 ? (
              <span className="text-xs text-warn">แก้ไว้ {changed} แถว ยังไม่ได้บันทึก</span>
            ) : null}
            <SubmitButton
              className="btn-primary"
              pendingLabel="กำลังบันทึก..."
              disabled={changed === 0}
            >
              บันทึกกำไร
            </SubmitButton>
          </span>
        </div>

        {/* ราคาพาร์ทเนอร์ — คิดจากต้นทุนเหมือนกันแต่คนละ % ปกติตั้งให้ต่ำกว่าราคาทั่วไป */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-brand-500/20 pt-3">
          <span className="text-sm font-medium text-grape-400">🤝 กำไรสำหรับ Partner</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={partnerBulk}
            onChange={(e) => setPartnerBulk(e.target.value)}
            className="input w-28"
            placeholder="เช่น 2"
            aria-label="เปอร์เซ็นต์กำไรพาร์ทเนอร์ที่จะใส่ให้ทุกแพ็ก"
          />
          <span className="text-sm text-mute">%</span>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => fillAllPartner(partnerBulk.trim())}
            disabled={partnerBulk.trim() === ''}
          >
            ใส่ให้ทุกแพ็ก
          </button>
          <button type="button" className="btn-ghost" onClick={() => fillAllPartner('')}>
            ล้างทุกช่อง
          </button>
          <span className="text-xs text-mute">
            ตั้งไว้ {partnerCount} จาก {total} แพ็ก · ช่องที่ว่าง พาร์ทเนอร์จ่ายเท่าราคาปกติ
          </span>
        </div>

        <p className="mt-2 text-xs leading-relaxed text-mute">
          ใส่ % แล้วกด <b className="text-slate-200">ใส่ให้ทุกแพ็ก</b>{' '}
          เพื่อกรอกให้ทุกแถวในตาราง จากนั้นแก้เฉพาะแถวที่อยากให้ต่างได้ แล้วกดบันทึกครั้งเดียว ·
          ยังไม่มีอะไรถูกบันทึกจนกว่าจะกดปุ่มบันทึก
        </p>

        {/* บอกให้เห็นว่ามีกี่แพ็กที่จะคิดราคาใหม่ให้เองตอนดึงข้อมูลรอบหน้า
            แพ็กที่ตั้งราคาเองจะไม่ขยับตาม พอปลายทางขึ้นราคาแล้วกำไรจะหดเงียบ ๆ */}
        <div className="mt-2 border-t border-brand-500/20 pt-2 text-xs leading-relaxed">
          {autoCount === total ? (
            <span className="text-good">
              ✓ ทุกแพ็กเกจ ({total}) คิดราคาอัตโนมัติ — ตอนดึงข้อมูลใหม่แล้วต้นทุนเปลี่ยน
              ราคาขายจะคิดใหม่ให้เองโดยกำไรเท่าเดิม
            </span>
          ) : (
            <span className="text-warn">
              ⚠ คิดราคาอัตโนมัติ {autoCount} จาก {total} แพ็กเกจ · อีก {total - autoCount} แพ็ก
              ตั้งราคาเองไว้{' '}
              <b className="text-slate-200">
                ซึ่งจะไม่ขยับตามตอนผู้ให้บริการขึ้นราคา ทำให้กำไรหดโดยไม่รู้ตัว
              </b>
            </span>
          )}
        </div>
      </div>
    </ActionForm>
  )
}

/**
 * เซลล์ราคาขาย / กำไร / ช่องกรอก ของแต่ละแถว
 * คืนเป็นหลาย <td> ติดกันเพราะต้องวางในแถวของตารางเดิม
 */
export function MarkupCells({
  productId,
  productName,
  cost,
  sellPrice,
  partnerPrice,
  showMoney,
}: {
  productId: number
  productName: string
  cost: number
  sellPrice: number
  /** ราคาพาร์ทเนอร์ที่บันทึกไว้ (null = ยังไม่ได้ตั้ง จ่ายเท่าราคาปกติ) */
  partnerPrice: number | null
  /** แสดงคอลัมน์กำไรไหม (เฉพาะผู้ดูแลระบบ) */
  showMoney: boolean
}) {
  const { values, saved, set, partnerValues, partnerSaved, setPartner } = useMarkup()

  const text = (values[productId] ?? '').trim()
  const savedText = (saved[productId] ?? '').trim()
  const pct = Number(text)
  const usePct = text !== '' && Number.isFinite(pct) && pct >= 0

  // สูตรเดียวกับที่ฝั่งเซิร์ฟเวอร์ใช้ตอนบันทึก (ปัดขึ้นเป็นจำนวนเต็มบาท)
  // ถ้าคิดคนละแบบ ตัวเลขที่เห็นตอนพิมพ์จะไม่ตรงกับที่บันทึกจริง
  const nextSell = usePct ? Math.ceil(cost * (1 + pct / 100)) : sellPrice
  const nextMargin = nextSell - cost

  const dirty = text !== savedText
  const bad = text !== '' && !usePct

  const pText = (partnerValues[productId] ?? '').trim()
  const pSavedText = (partnerSaved[productId] ?? '').trim()
  const pPct = Number(pText)
  const usePPct = pText !== '' && Number.isFinite(pPct) && pPct >= 0
  // ไม่ได้ตั้ง % พาร์ทเนอร์ = พาร์ทเนอร์จ่ายเท่าราคาปกติที่กำลังจะบันทึก
  const nextPartner = usePPct ? Math.ceil(cost * (1 + pPct / 100)) : (partnerPrice ?? nextSell)
  const pDirty = pText !== pSavedText
  const pBad = pText !== '' && !usePPct

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
        {/* ส่งค่าเดิมไปด้วย ฝั่งเซิร์ฟเวอร์จะได้รู้ว่าแถวไหนถูกแก้จริง
            ไม่งั้นแถวที่ไม่ได้แตะจะถูกตีความว่าสั่งให้เลิกคิดอัตโนมัติ แล้วโดนล้างค่าทิ้ง */}
        <input
          type="hidden"
          form="markup-form"
          name={`markup_was_${productId}`}
          value={savedText}
        />
        <input
          form="markup-form"
          name={`markup_${productId}`}
          type="number"
          min={0}
          step="0.01"
          value={values[productId] ?? ''}
          onChange={(e) => set(productId, e.target.value)}
          className={`input w-24 px-2 py-1 text-right text-xs ${
            bad ? 'border-bad' : dirty ? 'border-warn' : ''
          }`}
          placeholder="ตั้งเอง"
          aria-label={`กำไรเปอร์เซ็นต์ของ ${productName}`}
        />
      </td>

      {/* ราคาพาร์ทเนอร์ที่จะได้ + ช่องกรอก % ของพาร์ทเนอร์ */}
      <td
        className={`text-right font-medium ${
          pDirty ? 'text-warn' : usePPct || partnerPrice != null ? 'text-grape-400' : 'text-mute'
        }`}
      >
        {money(nextPartner)}
      </td>
      <td className="text-right">
        <input
          type="hidden"
          form="markup-form"
          name={`pmarkup_was_${productId}`}
          value={pSavedText}
        />
        <input
          form="markup-form"
          name={`pmarkup_${productId}`}
          type="number"
          min={0}
          step="0.01"
          value={partnerValues[productId] ?? ''}
          onChange={(e) => setPartner(productId, e.target.value)}
          className={`input w-24 px-2 py-1 text-right text-xs ${
            pBad ? 'border-bad' : pDirty ? 'border-warn' : ''
          }`}
          placeholder="เท่าปกติ"
          aria-label={`กำไรเปอร์เซ็นต์สำหรับพาร์ทเนอร์ของ ${productName}`}
        />
      </td>
    </>
  )
}
