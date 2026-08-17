import Link from 'next/link'
import { redirect } from 'next/navigation'
import { q } from '@/lib/db'
import { getShopCustomer, getSiteSettings, pointsPerBaht } from '@/lib/shop'
import { redeemCreditCodeAction, exchangePointsAction } from '@/lib/actions/creditCodes'
import { ActionForm, SubmitButton } from '@/components/ActionForm'
import { dateTime, money, num } from '@/lib/format'

export const dynamic = 'force-dynamic'

const KIND_LABEL: Record<string, string> = {
  redeem: 'แลกโค้ดเครดิต',
  exchange: 'แลกเป็นยอดเงิน',
  adjust: 'ร้านปรับให้',
}

export default async function ShopCreditPage() {
  const customer = await getShopCustomer()
  if (!customer) redirect('/shop/login')

  const settings = await getSiteSettings()
  const rate = pointsPerBaht(settings)

  const history = await q<{
    created_at: string
    kind: string
    points: number
    balance_after: number
    amount: number | null
    note: string | null
  }>(
    `select created_at, kind, points::float8 as points, balance_after::float8 as balance_after,
            amount::float8 as amount, note
       from point_transactions
      where customer_id = $1
      order by created_at desc limit 30`,
    [customer.id]
  )

  // แลกได้เท่าที่หารลงตัวเท่านั้น เศษที่เหลือเก็บไว้รอบหน้า
  const exchangeable = Math.floor(customer.points / rate) * rate
  const bahtIfExchanged = exchangeable / rate

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold text-white">เครดิตของฉัน</h1>
      <p className="mt-1 text-sm text-mute">
        แลกโค้ดเพื่อรับเครดิต แล้วแลกเครดิตเป็นยอดเงินไว้ซื้อของในร้าน
      </p>

      {/* ยอดสองก้อน วางคู่กันให้เห็นความต่างชัด ๆ ว่าอันไหนใช้ซื้อของได้ */}
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-grape-500/40 bg-linear-to-br from-grape-600/25 to-ink-900/60 p-5">
          <p className="text-sm text-mute">เครดิตคงเหลือ</p>
          <p className="mt-1 text-3xl font-bold text-grape-400">{num(customer.points)}</p>
          <p className="mt-1 text-xs text-mute">
            {num(rate)} เครดิต = 1 บาท · ต้องแลกเป็นยอดเงินก่อนถึงจะซื้อของได้
          </p>
        </div>
        <div className="rounded-2xl border border-good/40 bg-linear-to-br from-good/20 to-ink-900/60 p-5">
          <p className="text-sm text-mute">ยอดเงินคงเหลือ</p>
          <p className="mt-1 text-3xl font-bold text-good">{money(customer.credit)}</p>
          <p className="mt-1 text-xs text-mute">บาท · ใช้ซื้อของในร้านได้ทันที</p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {/* แลกโค้ด */}
        <div className="rounded-2xl border border-ink-700/70 bg-ink-900/75 p-5 backdrop-blur-md">
          <h2 className="text-base font-semibold text-white">🎟️ แลกโค้ดเครดิต</h2>
          <p className="mt-1 mb-3 text-xs leading-relaxed text-mute">
            กรอกโค้ดที่ได้รับจากทางร้าน โค้ดหนึ่งใบใช้ได้ครั้งเดียว
          </p>
          <ActionForm action={redeemCreditCodeAction} className="space-y-3" resetOnSuccess>
            <input
              name="code"
              className="input text-center font-mono tracking-widest uppercase"
              placeholder="XXXX-XXXX-XXXX"
              autoComplete="off"
              required
            />
            <SubmitButton className="btn-primary w-full" pendingLabel="กำลังตรวจสอบ...">
              แลกโค้ด
            </SubmitButton>
          </ActionForm>
        </div>

        {/* แลกเครดิตเป็นเงิน */}
        <div className="rounded-2xl border border-ink-700/70 bg-ink-900/75 p-5 backdrop-blur-md">
          <h2 className="text-base font-semibold text-white">💱 แลกเป็นยอดเงิน</h2>
          <p className="mt-1 mb-3 text-xs leading-relaxed text-mute">
            {exchangeable > 0 ? (
              <>
                ตอนนี้แลกได้สูงสุด {num(exchangeable)} เครดิต = {money(bahtIfExchanged)} บาท
              </>
            ) : (
              <>ต้องมีอย่างน้อย {num(rate)} เครดิตถึงจะแลกได้</>
            )}
          </p>
          <ActionForm action={exchangePointsAction} className="space-y-3">
            <input
              name="points"
              type="number"
              inputMode="numeric"
              min={rate}
              step={rate}
              max={exchangeable || undefined}
              defaultValue={exchangeable || ''}
              className="input text-center"
              placeholder={`ใส่ทีละ ${num(rate)}`}
              required
            />
            <SubmitButton
              className="btn-primary w-full"
              pendingLabel="กำลังแลก..."
              disabled={exchangeable <= 0}
            >
              แลกเป็นยอดเงิน
            </SubmitButton>
          </ActionForm>
        </div>
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold text-white">
          ประวัติเครดิต
          <span className="ml-2 text-sm font-normal text-mute">{num(history.length)} รายการ</span>
        </h2>
        {history.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink-700/70 bg-ink-900/40 px-4 py-10 text-center text-sm text-mute backdrop-blur-sm">
            ยังไม่มีประวัติ — แลกโค้ดใบแรกได้จากช่องด้านบน
          </div>
        ) : (
          <div className="card border-ink-700/70 bg-ink-900/75 backdrop-blur-md">
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>เวลา</th>
                    <th>รายการ</th>
                    <th className="text-right">เครดิต</th>
                    <th className="text-right">คงเหลือ</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h, i) => (
                    <tr key={i}>
                      <td className="whitespace-nowrap text-xs text-mute">
                        {dateTime(h.created_at)}
                      </td>
                      <td className="text-slate-200">
                        {KIND_LABEL[h.kind] ?? h.kind}
                        {h.amount ? (
                          <span className="ml-1 text-xs text-good">
                            (+{money(h.amount)} บาท)
                          </span>
                        ) : null}
                        {h.note ? <span className="block text-xs text-mute">{h.note}</span> : null}
                      </td>
                      <td
                        className={`text-right font-medium ${h.points >= 0 ? 'text-good' : 'text-warn'}`}
                      >
                        {h.points >= 0 ? '+' : ''}
                        {num(h.points)}
                      </td>
                      <td className="text-right text-slate-300">{num(h.balance_after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <p className="mt-6 text-xs leading-relaxed text-mute">
        เครดิตใช้ซื้อของโดยตรงไม่ได้ ต้องแลกเป็นยอดเงินก่อน ·{' '}
        <Link href="/shop/me" className="text-brand-400 underline">
          ดูบัญชีของฉัน
        </Link>
      </p>
    </div>
  )
}
