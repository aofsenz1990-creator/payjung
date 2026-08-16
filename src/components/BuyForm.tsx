'use client'

import { useState } from 'react'
import { ActionForm, SubmitButton, type ActionState } from '@/components/ActionForm'

export type BuyPackage = {
  id: number
  name: string
  sell_price: number
  image_url: string | null
  track_stock: boolean
  stock_qty: number
  /** ชื่อสินค้าฝั่งผู้ให้บริการ ใช้แยกประเภทของเกมเดียวกัน เช่น OneOne THB / GOC */
  variant?: string | null
  /** ช่องที่ต้องกรอกของแพ็กนี้ ต่างประเภทกันใช้คนละชุด (UID / Link / AID) */
  fields?: BuyField[] | null
}

/** ช่องที่เกมนี้บังคับให้กรอก ส่งมาจากผู้ให้บริการ */
export type BuyField = {
  key: string
  label: string
  options?: Array<{ value: string; label: string }>
}

/** ป้ายกำกับที่ผู้ให้บริการส่งมาเป็นภาษาอังกฤษ แปลตัวที่เจอบ่อยให้อ่านง่ายขึ้น */
const FIELD_LABEL_TH: Record<string, string> = {
  uid: 'ไอดีเกม / UID',
  link: 'ลิงก์เติมเกม (URL)',
  aid: 'AID',
  server: 'เซิร์ฟเวอร์ / ภูมิภาค',
  player_name: 'ชื่อตัวละคร',
  level: 'เลเวล',
  id_login: 'ไอดีที่ใช้ล็อกอิน',
  password: 'รหัสผ่าน',
  login: 'ล็อกอินด้วยอะไร',
  recovery_code: 'รหัสกู้คืน',
  contact_phone: 'เบอร์โทรติดต่อ',
  contact_fb: 'Facebook ติดต่อ',
}

/** คำใบ้เพิ่มเติมสำหรับช่องที่ลูกค้ามักงงว่าต้องเอามาจากไหน */
const FIELD_HINT_TH: Record<string, string> = {
  link: 'คัดลอกลิงก์เติมเงินจากในเกมมาวาง',
  aid: 'ดูได้ในหน้าโปรไฟล์ของเกม',
  uid: 'เลขประจำตัวผู้เล่น ดูได้ในหน้าโปรไฟล์',
}

function fieldLabel(f: BuyField) {
  return FIELD_LABEL_TH[f.key] ?? f.label ?? f.key
}

const baht = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** เลือกแพ็กเกจ ใส่จำนวน แล้วกดสั่งซื้อโดยตัดจากเครดิต */
export function BuyForm({
  action,
  packages,
  credit,
  signedIn,
  defaultGameUid,
  fields,
}: {
  action: (formData: FormData) => Promise<ActionState>
  packages: BuyPackage[]
  credit: number
  signedIn: boolean
  defaultGameUid?: string | null
  /** ช่องที่เกมนี้บังคับกรอก ถ้าไม่มีจะใช้ช่องไอดีเกมช่องเดียวแบบเดิม */
  fields?: BuyField[] | null
}) {
  const [productId, setProductId] = useState<number | null>(packages[0]?.id ?? null)
  const [qty, setQty] = useState(1)

  // เกมเดียวกันอาจมีหลายประเภทตามประเทศ/ค่าเงิน ให้ลูกค้าเลือกก่อนแล้วค่อยโชว์แพ็กเกจของประเภทนั้น
  const variants = [...new Set(packages.map((p) => p.variant).filter(Boolean))] as string[]
  const hasVariants = variants.length > 1
  const [variant, setVariant] = useState<string | null>(variants[0] ?? null)

  const shown = hasVariants ? packages.filter((p) => p.variant === variant) : packages
  const selected = shown.find((p) => p.id === productId) ?? shown[0] ?? null

  // ช่องที่ต้องกรอกยึดตามแพ็กที่เลือก เพราะคนละประเภทใช้คนละชุด (UID / Link / AID)
  const activeFields = selected?.fields?.length ? selected.fields : (fields ?? null)
  const hasFields = Boolean(activeFields && activeFields.length > 0)
  const total = selected ? selected.sell_price * qty : 0
  const notEnough = signedIn && total > credit
  const outOfStock = Boolean(selected?.track_stock && selected.stock_qty < qty)

  return (
    <ActionForm action={action} className="space-y-5">
      <input type="hidden" name="product_id" value={selected?.id ?? ''} />

      {/* เกมเดียวกันแต่คนละประเทศ/ค่าเงิน — ให้เลือกก่อนว่าจะเติมแบบไหน */}
      {hasVariants ? (
        <div>
          <p className="label">เลือกประเภท</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {variants.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  setVariant(v)
                  // แพ็กที่เลือกไว้เป็นของประเภทเดิม ต้องล้างก่อนไม่งั้นสั่งข้ามประเภท
                  setProductId(null)
                }}
                className={`rounded-xl border px-3 py-3 text-center text-sm transition ${
                  v === variant
                    ? 'border-brand-500 bg-brand-600/15 font-medium text-white'
                    : 'border-ink-700 bg-ink-850 text-slate-300 hover:border-ink-600'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-mute">
            แต่ละประเภทเติมคนละแบบและใช้ข้อมูลคนละชุด เลือกให้ตรงกับบัญชีเกมของคุณ
          </p>
        </div>
      ) : null}
      <input type="hidden" name="qty" value={qty} />

      <div>
        <p className="label">เลือกแพ็กเกจ</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {shown.map((p) => {
            const active = p.id === productId
            const soldOut = p.track_stock && p.stock_qty <= 0
            return (
              <button
                key={p.id}
                type="button"
                disabled={soldOut}
                onClick={() => setProductId(p.id)}
                className={`flex items-center gap-3 rounded-xl border px-3 py-3 text-left transition ${
                  soldOut
                    ? 'cursor-not-allowed border-ink-800 bg-ink-900 opacity-50'
                    : active
                      ? 'border-brand-500 bg-brand-600/15'
                      : 'border-ink-700 bg-ink-850 hover:border-ink-600'
                }`}
              >
                {p.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.image_url}
                    alt={p.name}
                    className="size-12 shrink-0 rounded-lg bg-ink-900 object-contain p-1"
                  />
                ) : (
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-ink-900 text-xl">
                    💎
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-white">{p.name}</span>
                  <span className="block text-sm text-brand-400">
                    {baht.format(p.sell_price)} บาท
                  </span>
                  {p.track_stock ? (
                    <span className="block text-xs text-mute">
                      {soldOut ? 'สินค้าหมด' : `เหลือ ${p.stock_qty} ชิ้น`}
                    </span>
                  ) : null}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* เกมที่ผู้ให้บริการบอกมาว่าต้องกรอกอะไรบ้าง จะสร้างช่องตามนั้น
            บางเกมต้องเลือกเซิร์ฟเวอร์/ภูมิภาคด้วย ถ้าไม่ถามแล้วส่งไปมั่ว ๆ
            ออเดอร์จะถูกปฏิเสธ หรือแย่กว่านั้นคือเติมเข้าผิดเซิร์ฟเวอร์ */}
        {hasFields ? (
          activeFields!.map((f) =>
            f.options && f.options.length > 0 ? (
              <div key={f.key}>
                <label className="label" htmlFor={`field_${f.key}`}>
                  {fieldLabel(f)}
                </label>
                <select
                  id={`field_${f.key}`}
                  name={`field_${f.key}`}
                  className="input"
                  defaultValue=""
                  required
                >
                  <option value="" disabled>
                    — กรุณาเลือก —
                  </option>
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div key={f.key}>
                <label className="label" htmlFor={`field_${f.key}`}>
                  {fieldLabel(f)}
                </label>
                <input
                  id={`field_${f.key}`}
                  name={`field_${f.key}`}
                  className="input"
                  type={f.key === 'password' ? 'password' : f.key === 'link' ? 'url' : 'text'}
                  defaultValue={f.key === 'uid' ? (defaultGameUid ?? '') : ''}
                  placeholder={
                    f.key === 'uid' ? 'เช่น 123456789' : f.key === 'link' ? 'https://...' : ''
                  }
                  required
                />
                {FIELD_HINT_TH[f.key] ? (
                  <p className="mt-1 text-xs text-mute">{FIELD_HINT_TH[f.key]}</p>
                ) : null}
              </div>
            )
          )
        ) : (
          <div>
            <label className="label" htmlFor="game_account">
              ไอดีเกม / UID ที่จะเติม
            </label>
            <input
              id="game_account"
              name="game_account"
              className="input"
              defaultValue={defaultGameUid ?? ''}
              placeholder="เช่น 123456789"
              required
            />
          </div>
        )}
        <div>
          <label className="label" htmlFor="qty">
            จำนวนแพ็ก
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-ghost px-3"
              onClick={() => setQty((v) => Math.max(1, v - 1))}
            >
              −
            </button>
            <input
              id="qty"
              type="number"
              min={1}
              max={99}
              className="input text-center"
              value={qty}
              onChange={(e) => setQty(Math.max(1, Math.min(99, Number(e.target.value) || 1)))}
            />
            <button type="button" className="btn-ghost px-3" onClick={() => setQty((v) => Math.min(99, v + 1))}>
              +
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-ink-700 bg-ink-850 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-mute">
              ยอดที่ต้องจ่าย{' '}
              <span className="ml-1 text-xl font-bold text-white">{baht.format(total)}</span>{' '}
              <span className="text-sm">บาท</span>
            </p>
            {signedIn ? (
              <p className="mt-1 text-xs text-mute">
                เครดิตคงเหลือ {baht.format(credit)} บาท
                {total > 0 && !notEnough ? (
                  <span className="text-good"> · เหลือหลังหัก {baht.format(credit - total)}</span>
                ) : null}
              </p>
            ) : null}
          </div>

          {signedIn ? (
            <SubmitButton
              className="btn-primary"
              disabled={!selected || notEnough || outOfStock}
              pendingLabel="กำลังสั่งซื้อ..."
            >
              สั่งซื้อด้วยเครดิต
            </SubmitButton>
          ) : (
            <a href="/shop/login" className="btn-primary">
              เข้าสู่ระบบเพื่อสั่งซื้อ
            </a>
          )}
        </div>

        {notEnough ? (
          <p className="mt-3 text-sm text-bad">
            ⚠ เครดิตไม่พอ ขาดอีก {baht.format(total - credit)} บาท — ติดต่อร้านเพื่อเติมเครดิต
          </p>
        ) : null}
        {outOfStock ? (
          <p className="mt-3 text-sm text-bad">⚠ จำนวนที่เลือกมากกว่าสินค้าที่เหลืออยู่</p>
        ) : null}
      </div>
    </ActionForm>
  )
}
