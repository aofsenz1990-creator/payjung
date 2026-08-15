'use client'

import { useState } from 'react'
import { ActionForm, SubmitButton, type ActionState } from '@/components/ActionForm'

export type StockProduct = {
  id: number
  name: string
  game: string
  stock_qty: number
  cost_price: number
}

export function StockForm({
  action,
  products,
}: {
  action: (formData: FormData) => Promise<ActionState>
  products: StockProduct[]
}) {
  const [kind, setKind] = useState<'in' | 'out' | 'adjust'>('in')
  const [productId, setProductId] = useState('')
  const selected = products.find((p) => String(p.id) === productId) ?? null

  const qtyLabel =
    kind === 'in' ? 'จำนวนที่รับเข้า' : kind === 'out' ? 'จำนวนที่ตัดออก' : 'จำนวนคงเหลือจริง'

  return (
    <ActionForm action={action} className="space-y-4" resetOnSuccess>
      <div>
        <label className="label" htmlFor="product_id">
          แพ็กเกจ
        </label>
        <select
          id="product_id"
          name="product_id"
          className="input"
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          required
        >
          <option value="">— เลือกแพ็กเกจที่นับสต๊อก —</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.game} · {p.name} (เหลือ {p.stock_qty})
            </option>
          ))}
        </select>
      </div>

      <div>
        <span className="label">ประเภท</span>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ['in', 'รับเข้า'],
              ['out', 'ตัดออก'],
              ['adjust', 'ปรับยอด'],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className={`cursor-pointer rounded-lg border px-3 py-2 text-center text-sm transition ${
                kind === value
                  ? 'border-brand-500 bg-brand-600/20 font-medium text-white'
                  : 'border-ink-700 bg-ink-850 text-slate-300 hover:border-ink-600'
              }`}
            >
              <input
                type="radio"
                name="kind"
                value={value}
                checked={kind === value}
                onChange={() => setKind(value)}
                className="sr-only"
              />
              {label}
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-mute">
          {kind === 'in'
            ? 'ซื้อบัตร/โค้ดเข้ามาเพิ่ม — ระบบจะบวกจำนวนให้'
            : kind === 'out'
              ? 'ตัดออกเอง เช่น ของหาย โค้ดเสีย หรือใช้เอง'
              : 'นับสต๊อกจริงแล้วตั้งค่าให้ตรง — ระบบจะบันทึกส่วนต่างไว้'}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="qty">
            {qtyLabel}
          </label>
          <input
            id="qty"
            name="qty"
            type="number"
            min={0}
            step={1}
            className="input"
            defaultValue={kind === 'adjust' ? (selected?.stock_qty ?? 0) : ''}
            key={`${kind}-${productId}`}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="unit_cost">
            ทุน / หน่วย
          </label>
          <input
            id="unit_cost"
            name="unit_cost"
            type="number"
            min={0}
            step="0.01"
            className="input"
            placeholder={kind === 'in' ? String(selected?.cost_price ?? '0.00') : 'ใช้เฉพาะรับเข้า'}
            disabled={kind !== 'in'}
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="note">
          หมายเหตุ
        </label>
        <input
          id="note"
          name="note"
          className="input"
          placeholder="เช่น ซื้อจากตัวแทน ล็อต 15/08"
        />
      </div>

      <SubmitButton className="btn-primary w-full">บันทึกการเคลื่อนไหว</SubmitButton>
    </ActionForm>
  )
}
