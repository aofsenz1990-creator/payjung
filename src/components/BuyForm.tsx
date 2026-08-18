'use client'

import { useEffect, useState } from 'react'
import {
  ActionForm,
  ActionMessage,
  SubmitButton,
  type ActionState,
} from '@/components/ActionForm'
import type { OrderFieldSpec } from '@/lib/orderField'

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
  // ชื่อที่เจอจากฝั่ง JCR และเกมที่ใช้บัญชีเฉพาะทาง
  roleid: 'Role ID',
  role_id: 'Role ID',
  charid: 'Character ID',
  character_id: 'Character ID',
  region: 'ภูมิภาค',
  zone: 'โซน / เซิร์ฟเวอร์',
  zoneid: 'โซน / เซิร์ฟเวอร์',
  riot_id: 'Riot ID (ชื่อ#แท็ก)',
  riotid: 'Riot ID (ชื่อ#แท็ก)',
  ign: 'ชื่อในเกม (IGN)',
  email: 'อีเมลของบัญชีเกม',
  phone: 'เบอร์โทรของบัญชีเกม',
}

/**
 * คำแนะนำของช่อง "ลิงก์" แยกตามประเภทของเกม
 *
 * เกมที่เติมด้วยลิงก์ แต่ละค่ายเอาลิงก์มาจากคนละที่ (OneOne / GOC / Razer)
 * ถ้าเขียนคำแนะนำรวมกันอันเดียว ลูกค้าจะวางลิงก์ผิดที่แล้วเติมไม่เข้า
 * ข้อความจริงให้ร้านไปตั้งเองในหลังร้าน เพราะร้านรู้ขั้นตอนของแต่ละค่ายดีที่สุด
 */
export type LinkHints = {
  oneone?: string | null
  goc?: string | null
  razer?: string | null
  fallback?: string | null
}

/** เดาประเภทลิงก์จากชื่อประเภทที่ผู้ให้บริการตั้งมา เช่น "OneOne THB", "Ragnarok (GOC)" */
function linkKindOf(variant: string | null | undefined): keyof LinkHints {
  const v = (variant ?? '').toLowerCase()
  if (v.includes('one')) return 'oneone'
  if (v.includes('goc')) return 'goc'
  if (v.includes('razer')) return 'razer'
  return 'fallback'
}

/** คำใบ้เพิ่มเติมสำหรับช่องที่ลูกค้ามักงงว่าต้องเอามาจากไหน */
const FIELD_HINT_TH: Record<string, string> = {
  link: 'คัดลอกลิงก์เติมเงินจากในเกมมาวาง',
  aid: 'ดูได้ในหน้าโปรไฟล์ของเกม',
  uid: 'เลขประจำตัวผู้เล่น ดูได้ในหน้าโปรไฟล์',
  roleid: 'รหัสตัวละคร คัดลอกจากในเกมมาวางให้ครบทุกตัวอักษร',
  role_id: 'รหัสตัวละคร คัดลอกจากในเกมมาวางให้ครบทุกตัวอักษร',
  riot_id: 'ใส่ให้ครบทั้งชื่อและแท็ก เช่น PlayerName#TH1',
  riotid: 'ใส่ให้ครบทั้งชื่อและแท็ก เช่น PlayerName#TH1',
  ign: 'พิมพ์ให้ตรงกับในเกมทุกตัวอักษร ไม่งั้นเติมเข้าผิดคน',
  player_name: 'พิมพ์ให้ตรงกับในเกมทุกตัวอักษร ไม่งั้นเติมเข้าผิดคน',
  server: 'เลือกให้ตรงกับเซิร์ฟเวอร์ที่เล่นอยู่ — เติมผิดเซิร์ฟเวอร์เอาคืนไม่ได้',
  region: 'เลือกให้ตรงกับภูมิภาคของบัญชี — เติมผิดภูมิภาคเอาคืนไม่ได้',
}

function fieldLabel(f: BuyField) {
  return FIELD_LABEL_TH[f.key] ?? f.label ?? f.key
}

/** ส่วนขึ้นต้นที่ทุกชื่อเหมือนกัน */
function commonPrefix(items: string[]) {
  if (items.length < 2) return ''
  let prefix = items[0]
  for (const s of items.slice(1)) {
    let i = 0
    while (i < prefix.length && i < s.length && prefix[i] === s[i]) i++
    prefix = prefix.slice(0, i)
    if (!prefix) break
  }
  return prefix
}

/**
 * ย่อชื่อประเภทให้เหลือเฉพาะส่วนที่ต่างกัน
 * ผู้ให้บริการตั้งชื่อสินค้าเป็น "Ragnarok : zero global (GOC)" ทุกตัว
 * ถ้าเอามาโชว์ทั้งชื่อ ปุ่มจะยาวและอ่านไม่ออกว่าต่างกันตรงไหน
 * ตัดส่วนที่ซ้ำกันทิ้งแล้วเหลือแค่ GOC / OneOne / Razer gold
 */
function variantLabel(all: string[], one: string) {
  const prefix = commonPrefix(all)
  const rest = one.slice(prefix.length)
  // ตัดวงเล็บและอักขระคั่นที่ค้างอยู่หัวท้ายหลังตัดส่วนซ้ำออก
  const cleaned = rest
    .replace(/^[\s(–—\-:|/]+/, '')
    .replace(/[\s)–—\-:|/]+$/, '')
    .trim()
  return cleaned || one
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
  linkHints,
  orderField,
}: {
  action: (formData: FormData) => Promise<ActionState>
  packages: BuyPackage[]
  credit: number
  signedIn: boolean
  defaultGameUid?: string | null
  /** ช่องที่เกมนี้บังคับกรอก ถ้าไม่มีจะใช้ช่องไอดีเกมช่องเดียวแบบเดิม */
  fields?: BuyField[] | null
  /** คำแนะนำของช่องลิงก์ แยกตามค่าย ตั้งได้จากหลังร้าน */
  linkHints?: LinkHints
  /** ชนิดช่องที่ร้านระบุเองรายเกม ใช้ตอนผู้ให้บริการไม่ได้บอกมา */
  orderField?: OrderFieldSpec | null
}) {
  const [productId, setProductId] = useState<number | null>(null)
  const [qty, setQty] = useState(1)
  /** เปิดกล่องกรอกข้อมูลหลังลูกค้าเลือกแพ็กเกจแล้ว */
  const [open, setOpen] = useState(false)

  // กด Esc เพื่อปิด และห้ามหน้าเบื้องหลังเลื่อนตามตอนกล่องเปิดอยู่
  // (บนมือถือถ้าไม่ล็อก พอเลื่อนในกล่องจนสุดแล้วหน้าเบื้องหลังจะเลื่อนต่อ สับสนมาก)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  // เกมเดียวกันอาจมีหลายช่องทางตามประเทศ/ค่าเงิน ให้ลูกค้าเลือกก่อนแล้วค่อยโชว์แพ็กของช่องทางนั้น
  //
  // แพ็กที่ยังไม่มีชื่อช่องทาง (นำเข้ามาก่อนจะมีระบบนี้) ต้องมีที่อยู่เสมอ
  // ถ้าปล่อยเป็นค่าว่างแล้วกรองด้วยชื่อช่องทาง แพ็กพวกนั้นจะหายไปจากหน้าเว็บทั้งหมด
  // ลูกค้าจะซื้อไม่ได้ทั้งที่เปิดขายอยู่ — จึงจับใส่กลุ่ม "อื่น ๆ" ไว้แทน
  const OTHER = 'อื่น ๆ'
  const variantOf = (p: BuyPackage) => p.variant?.trim() || OTHER

  const variants = [...new Set(packages.map(variantOf))]
  const hasVariants = variants.length > 1
  const [variant, setVariant] = useState<string>(variants[0] ?? OTHER)

  const shown = hasVariants ? packages.filter((p) => variantOf(p) === variant) : packages
  const selected = shown.find((p) => p.id === productId) ?? shown[0] ?? null

  // ช่องที่ต้องกรอกยึดตามแพ็กที่เลือก เพราะคนละประเภทใช้คนละชุด (UID / Link / AID)
  const activeFields = selected?.fields?.length ? selected.fields : (fields ?? null)
  const hasFields = Boolean(activeFields && activeFields.length > 0)
  const total = selected ? selected.sell_price * qty : 0
  const notEnough = signedIn && total > credit
  const outOfStock = Boolean(selected?.track_stock && selected.stock_qty < qty)

  return (
    <ActionForm action={action} className="space-y-5" hideMessage>
      <input type="hidden" name="product_id" value={selected?.id ?? ''} />

      {/* เกมเดียวกันแต่คนละประเทศ/ค่าเงิน — ให้เลือกก่อนว่าจะเติมแบบไหน */}
      {hasVariants ? (
        <div>
          <p className="label">เลือกช่องทางเติม</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {variants.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  setVariant(v)
                  // แพ็กที่เลือกไว้เป็นของประเภทเดิม ต้องล้างก่อนไม่งั้นสั่งข้ามประเภท
                  setProductId(null)
                  setOpen(false)
                }}
                className={`rounded-xl border px-3 py-3 text-center text-sm transition ${
                  v === variant
                    ? 'border-brand-500 bg-brand-600/15 font-medium text-fg'
                    : 'border-ink-700 bg-ink-850 text-body hover:border-ink-600'
                }`}
              >
                {variantLabel(variants, v)}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-mute">
            แต่ละช่องทางเติมคนละแบบและใช้ข้อมูลคนละชุด เลือกให้ตรงกับบัญชีเกมของคุณ
          </p>
        </div>
      ) : null}
      <input type="hidden" name="qty" value={qty} />

      <div>
        <p className="label">เลือกสินค้าที่ต้องการ</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {shown.map((p) => {
            // เทียบกับแพ็กที่ระบบใช้จริง ไม่ใช่ค่าที่ผู้ใช้กด
            // เพราะตอนเปิดหน้ามาครั้งแรกยังไม่มีใครกด แต่ระบบเลือกแพ็กแรกไว้ให้แล้ว
            // ถ้าเทียบกับค่าที่กด การ์ดจะไม่ขึ้นไฮไลต์ทั้งที่ส่งค่านั้นไปจริง
            const active = p.id === selected?.id
            const soldOut = p.track_stock && p.stock_qty <= 0
            return (
              <button
                key={p.id}
                type="button"
                disabled={soldOut}
                onClick={() => {
                  setProductId(p.id)
                  setQty(1)
                  setOpen(true)
                }}
                className={`flex flex-col items-center gap-2 rounded-xl border px-3 py-4 text-center transition ${
                  soldOut
                    ? 'cursor-not-allowed border-ink-800 bg-ink-900 opacity-50'
                    : active
                      ? 'border-brand-500 bg-brand-600/15 shadow-lg shadow-brand-600/10'
                      : 'border-ink-700 bg-ink-850 hover:border-ink-600 hover:bg-ink-800'
                }`}
              >
                {p.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.image_url}
                    alt={p.name}
                    className="size-14 shrink-0 rounded-lg bg-ink-900/60 object-contain p-1"
                  />
                ) : (
                  <span className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-ink-900/60 text-2xl">
                    💎
                  </span>
                )}
                <span className="w-full">
                  <span className="block text-sm leading-snug font-medium text-fg">
                    {p.name}
                  </span>
                  <span className="mt-1 block text-lg font-bold text-brand-400">
                    ฿{baht.format(p.sell_price)}
                  </span>
                  {p.track_stock ? (
                    <span className="mt-0.5 block text-xs text-mute">
                      {soldOut ? 'สินค้าหมด' : `เหลือ ${p.stock_qty} ชิ้น`}
                    </span>
                  ) : null}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* กล่องสั่งซื้อ — เปิดเมื่อลูกค้าเลือกแพ็กเกจแล้ว
          อยู่ในฟอร์มเดียวกับด้านบน จึงส่งค่าที่กรอกไปพร้อมกันได้เลย
          และ **ต้องไม่เรนเดอร์ตอนปิด** เพราะช่อง required ที่ซ่อนอยู่จะทำให้กดส่งฟอร์มไม่ได้
          โดยไม่มีอะไรขึ้นเตือน (เบราว์เซอร์เลื่อนไปหาช่องที่มองไม่เห็นแล้วค้างอยู่แค่นั้น) */}
      {open && selected ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`สั่งซื้อ ${selected.name}`}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4"
          onMouseDown={(e) => {
            // ปิดเมื่อคลิกพื้นหลัง แต่ต้องเป็นการคลิกที่พื้นหลังจริง ๆ
            // (ถ้าใช้ onClick แล้วลากเมาส์จากในกล่องออกมาปล่อย จะถือว่าคลิกพื้นหลังแล้วปิดทิ้งทั้งที่ยังกรอกอยู่)
            if (e.target === e.currentTarget) setOpen(false)
          }}
        >
          <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-ink-700 bg-ink-900 p-5 shadow-2xl sm:rounded-2xl">
            <div className="mb-4 flex items-start gap-3">
              {selected.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selected.image_url}
                  alt=""
                  className="size-12 shrink-0 rounded-lg bg-ink-850 object-contain p-1"
                />
              ) : (
                <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-ink-850 text-2xl">
                  💎
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-snug font-medium text-fg">{selected.name}</p>
                <p className="mt-0.5 text-sm font-bold text-brand-400">
                  ฿{baht.format(selected.sell_price)} / แพ็ก
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="btn-ghost size-9 shrink-0 p-0 text-lg"
                aria-label="ปิด"
              >
                ✕
              </button>
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
                {f.key === 'link' ? (
                  // ช่องลิงก์ใช้คำแนะนำของค่ายนั้น ๆ ถ้าร้านยังไม่ได้ตั้งไว้ค่อยใช้คำกลาง
                  <p className="mt-1 text-xs leading-relaxed text-mute">
                    {linkHints?.[linkKindOf(selected?.variant)] ||
                      linkHints?.fallback ||
                      FIELD_HINT_TH.link}
                  </p>
                ) : FIELD_HINT_TH[f.key] ? (
                  <p className="mt-1 text-xs text-mute">{FIELD_HINT_TH[f.key]}</p>
                ) : null}
              </div>
            )
          )
        ) : (
          <div>
            <label className="label" htmlFor="game_account">
              {orderField?.label ?? 'ไอดีเกม / UID ที่จะเติม'}
            </label>
            <input
              id="game_account"
              name="game_account"
              className="input"
              type={orderField?.type ?? 'text'}
              // เติมไอดีที่ลูกค้าเคยบันทึกไว้ให้เฉพาะช่องที่เป็นไอดีเกมจริง ๆ
              // ถ้าเป็นช่องลิงก์แล้วไปเติมเลขไอดีให้ ลูกค้าจะงงและอาจกดสั่งทั้งอย่างนั้น
              defaultValue={!orderField || orderField.key === 'uid' ? (defaultGameUid ?? '') : ''}
              placeholder={orderField?.placeholder ?? 'เช่น 123456789'}
              required
            />
            <p className="mt-1 text-xs leading-relaxed text-mute">
              {orderField?.hint ?? 'เลขประจำตัวผู้เล่น ดูได้ในหน้าโปรไฟล์ของเกม'}
            </p>
          </div>
        )}
        <div>
          <label className="label" htmlFor="qty">
            จำนวนแพ็ก
          </label>
          {/* ปุ่มบวกลบต้องกว้างและสูงอย่างน้อย 44px ตามขนาดนิ้วมือ
              ของเดิมกว้างแค่ 31px กดพลาดง่ายมากบนมือถือ */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-ghost size-11 shrink-0 p-0 text-lg"
              aria-label="ลดจำนวน"
              onClick={() => setQty((v) => Math.max(1, v - 1))}
            >
              −
            </button>
            <input
              id="qty"
              type="number"
              inputMode="numeric"
              min={1}
              max={99}
              className="input h-11 text-center"
              value={qty}
              onChange={(e) => setQty(Math.max(1, Math.min(99, Number(e.target.value) || 1)))}
            />
            <button
              type="button"
              className="btn-ghost size-11 shrink-0 p-0 text-lg"
              aria-label="เพิ่มจำนวน"
              onClick={() => setQty((v) => Math.min(99, v + 1))}
            >
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
              <span className="ml-1 text-xl font-bold text-fg">{baht.format(total)}</span>{' '}
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

            {/* ผลลัพธ์ต้องขึ้นในกล่อง ไม่ใช่ท้ายฟอร์มที่อยู่หลังฉากดำ ลูกค้าจะไม่เห็นเลย */}
            <ActionMessage className="mt-3" />
          </div>
        </div>
      ) : null}
    </ActionForm>
  )
}
