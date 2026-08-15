'use client'

import { useCallback, useMemo, useState } from 'react'
import { ActionForm, SubmitButton, type ActionState } from '@/components/ActionForm'
import { SlipInput } from '@/components/SlipInput'
import { PAYMENT_METHODS } from '@/lib/constants'

export type GameOption = { id: number; name: string }
export type ProductOption = {
  id: number
  game_id: number
  name: string
  sell_price: number
  cost_price: number
  track_stock: boolean
  stock_qty: number
}
export type CustomerOption = { id: number; name: string; game_uid: string | null }

const baht = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function SaleForm({
  action,
  games,
  products,
  customers,
  isAdmin,
  defaultSoldAt,
}: {
  action: (formData: FormData) => Promise<ActionState>
  games: GameOption[]
  products: ProductOption[]
  customers: CustomerOption[]
  isAdmin: boolean
  defaultSoldAt: string
}) {
  const [gameId, setGameId] = useState('')
  const [productId, setProductId] = useState('')
  const [itemName, setItemName] = useState('')
  const [qty, setQty] = useState('1')
  const [price, setPrice] = useState('')
  const [cost, setCost] = useState('')
  const [hasSlip, setHasSlip] = useState(false)
  // เปลี่ยน key เพื่อล้างรูปที่แนบไว้หลังบันทึกบิลผ่าน กันเผลอใช้สลิปเดิมซ้ำกับบิลถัดไป
  const [slipKey, setSlipKey] = useState(0)

  const handleSaved = useCallback(() => {
    setSlipKey((k) => k + 1)
    setHasSlip(false)
    setProductId('')
    setItemName('')
    setQty('1')
    setPrice('')
    setCost('')
  }, [])

  const gameProducts = useMemo(
    () => products.filter((p) => String(p.game_id) === gameId),
    [products, gameId]
  )
  const selected = products.find((p) => String(p.id) === productId) ?? null

  const qtyNum = Math.max(Number(qty) || 0, 0)
  const total = qtyNum * (Number(price) || 0)
  const profit = total - qtyNum * (Number(cost) || 0)

  function pickProduct(id: string) {
    setProductId(id)
    const p = products.find((x) => String(x.id) === id)
    if (p) {
      setItemName(p.name)
      setPrice(String(p.sell_price))
      setCost(String(p.cost_price))
    }
  }

  return (
    <ActionForm
      action={action}
      resetOnSuccess={false}
      onSuccess={handleSaved}
      className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
    >
      <div>
        <label className="label" htmlFor="sold_at">
          วันและเวลาที่เติม
        </label>
        <input
          id="sold_at"
          name="sold_at"
          type="datetime-local"
          className="input"
          defaultValue={defaultSoldAt}
          required
        />
      </div>

      <div>
        <label className="label" htmlFor="game_id">
          เกม
        </label>
        <select
          id="game_id"
          name="game_id"
          className="input"
          value={gameId}
          onChange={(e) => {
            setGameId(e.target.value)
            setProductId('')
          }}
        >
          <option value="">— เลือกเกม —</option>
          {games.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="product_id">
          แพ็กเกจ
        </label>
        <select
          id="product_id"
          name="product_id"
          className="input"
          value={productId}
          onChange={(e) => pickProduct(e.target.value)}
          disabled={!gameId}
        >
          <option value="">{gameId ? '— เลือกแพ็กเกจ / หรือพิมพ์เอง —' : 'เลือกเกมก่อน'}</option>
          {gameProducts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {baht.format(p.sell_price)} ฿
              {p.track_stock ? ` (เหลือ ${p.stock_qty})` : ''}
            </option>
          ))}
        </select>
        {selected?.track_stock ? (
          <p
            className={`mt-1 text-xs ${
              selected.stock_qty <= 0
                ? 'text-bad'
                : selected.stock_qty < qtyNum
                  ? 'text-bad'
                  : 'text-mute'
            }`}
          >
            สต๊อกคงเหลือ {selected.stock_qty} ชิ้น
            {selected.stock_qty < qtyNum ? ' — ไม่พอกับจำนวนที่ขาย' : ''}
          </p>
        ) : null}
      </div>

      <div>
        <label className="label" htmlFor="item_name">
          ชื่อรายการที่ขาย
        </label>
        <input
          id="item_name"
          name="item_name"
          className="input"
          value={itemName}
          onChange={(e) => setItemName(e.target.value)}
          placeholder="เช่น 100 เพชร / บัตร 300 บาท"
          required
        />
      </div>

      <div>
        <label className="label" htmlFor="game_account">
          ไอดี / UID ที่เติมให้
        </label>
        <input
          id="game_account"
          name="game_account"
          className="input"
          placeholder="เช่น 123456789 หรือ ชื่อในเกม"
        />
      </div>

      <div>
        <label className="label" htmlFor="customer_id">
          ลูกค้า
        </label>
        <select id="customer_id" name="customer_id" className="input" defaultValue="">
          <option value="">ลูกค้าทั่วไป (ไม่ระบุ)</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.game_uid ? ` · ${c.game_uid}` : ''}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="qty">
          จำนวน
        </label>
        <input
          id="qty"
          name="qty"
          type="number"
          min={1}
          step={1}
          className="input"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          required
        />
      </div>

      <div>
        <label className="label" htmlFor="unit_price">
          ราคาขาย / หน่วย (บาท)
        </label>
        <input
          id="unit_price"
          name="unit_price"
          type="number"
          min={0}
          step="0.01"
          className="input"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          required
        />
      </div>

      {isAdmin ? (
        <div>
          <label className="label" htmlFor="unit_cost">
            ต้นทุน / หน่วย (บาท)
          </label>
          <input
            id="unit_cost"
            name="unit_cost"
            type="number"
            min={0}
            step="0.01"
            className="input"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder="ปล่อยว่างเพื่อใช้ทุนของแพ็กเกจ"
          />
        </div>
      ) : null}

      <div>
        <label className="label" htmlFor="payment_method">
          ช่องทางรับเงิน
        </label>
        <select id="payment_method" name="payment_method" className="input" defaultValue="เงินสด">
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="status">
          สถานะ
        </label>
        <select id="status" name="status" className="input" defaultValue="paid">
          <option value="paid">สำเร็จ (รับเงินแล้ว)</option>
          <option value="pending">รอดำเนินการ</option>
        </select>
      </div>

      <div className="md:col-span-2 lg:col-span-1">
        <label className="label" htmlFor="note">
          หมายเหตุ
        </label>
        <input id="note" name="note" className="input" placeholder="ไม่บังคับ" />
      </div>

      <div className="md:col-span-2 lg:col-span-2">
        <SlipInput key={slipKey} onChange={setHasSlip} />
      </div>

      <div className="md:col-span-2 lg:col-span-3">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-ink-700 bg-ink-850 px-4 py-3">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <span className="text-sm text-mute">
              ยอดรวม{' '}
              <span className="text-lg font-bold text-white">{baht.format(total)}</span> บาท
            </span>
            {isAdmin ? (
              <span className="text-sm text-mute">
                กำไร{' '}
                <span className={`font-semibold ${profit >= 0 ? 'text-good' : 'text-bad'}`}>
                  {baht.format(profit)}
                </span>{' '}
                บาท
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {!hasSlip ? (
              <span className="text-xs text-warn">⚠ ต้องแนบสลิปก่อนจึงจะบันทึกได้</span>
            ) : null}
            <SubmitButton
              className="btn-primary"
              disabled={!hasSlip}
              title={hasSlip ? undefined : 'กรุณาแนบสลิปโอนเงินก่อน'}
            >
              บันทึกการขาย
            </SubmitButton>
          </div>
        </div>
      </div>
    </ActionForm>
  )
}
