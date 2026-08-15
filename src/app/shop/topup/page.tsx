import Link from 'next/link'
import { redirect } from 'next/navigation'
import { q } from '@/lib/db'
import { getShopCustomer, getSiteSettings } from '@/lib/shop'
import { requestTopupAction } from '@/lib/actions/topups'
import { dateTime, money, num } from '@/lib/format'
import { ActionForm, SubmitButton } from '@/components/ActionForm'
import { SlipInput } from '@/components/SlipInput'

export const dynamic = 'force-dynamic'

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  pending: { text: 'รอร้านตรวจสอบ', cls: 'bg-warn/15 text-warn' },
  approved: { text: 'เติมเครดิตแล้ว', cls: 'bg-good/15 text-good' },
  rejected: { text: 'ไม่ผ่าน', cls: 'bg-bad/15 text-bad' },
}

export default async function ShopTopupPage() {
  const customer = await getShopCustomer()
  if (!customer) redirect('/shop/login')

  const [settings, requests] = await Promise.all([
    getSiteSettings(),
    q<{
      id: number
      amount: number
      status: string
      reject_reason: string | null
      created_at: string
      reviewed_at: string | null
    }>(
      `select id, amount::float8 as amount, status, reject_reason, created_at, reviewed_at
         from credit_requests where customer_id = $1
        order by created_at desc limit 20`,
      [customer.id]
    ),
  ])

  const hasBank = Boolean(settings.bank_account_no || settings.promptpay || settings.payment_qr)

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink-700/70 bg-linear-to-r from-brand-600/20 to-grape-600/20 p-5 backdrop-blur-sm">
        <div>
          <p className="text-sm text-mute">เครดิตคงเหลือของคุณ</p>
          <p className="text-3xl font-bold text-good">{money(customer.credit)}</p>
        </div>
        <Link href="/shop/me" className="btn-ghost">
          บัญชีของฉัน
        </Link>
      </div>

      {!hasBank ? (
        <div className="card border-warn/40 bg-warn/10 backdrop-blur-md">
          <p className="text-sm text-warn">
            ทางร้านยังไม่ได้ตั้งค่าช่องทางรับเงิน กรุณาติดต่อร้านโดยตรงเพื่อเติมเครดิต
            (ดูช่องทางติดต่อด้านล่างหน้าเว็บ)
          </p>
        </div>
      ) : (
        <>
          {/* ช่องทางโอนเงิน */}
          <section className="card border-ink-700/70 bg-ink-900/75 backdrop-blur-md">
            <h1 className="text-lg font-bold text-white">1. โอนเงินมาที่บัญชีนี้</h1>
            <div className="mt-4 grid gap-5 sm:grid-cols-[1fr_auto]">
              <dl className="space-y-3 text-sm">
                {settings.bank_name ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-mute">ธนาคาร</dt>
                    <dd className="font-medium text-white">{settings.bank_name}</dd>
                  </div>
                ) : null}
                {settings.bank_account_no ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-mute">เลขที่บัญชี</dt>
                    <dd className="font-mono text-base font-bold tracking-wide text-brand-400">
                      {settings.bank_account_no}
                    </dd>
                  </div>
                ) : null}
                {settings.bank_account_name ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-mute">ชื่อบัญชี</dt>
                    <dd className="text-white">{settings.bank_account_name}</dd>
                  </div>
                ) : null}
                {settings.promptpay ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-mute">พร้อมเพย์</dt>
                    <dd className="font-mono font-bold text-brand-400">{settings.promptpay}</dd>
                  </div>
                ) : null}
              </dl>

              {settings.payment_qr ? (
                <div className="justify-self-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={settings.payment_qr}
                    alt="QR Code สำหรับโอนเงิน"
                    className="w-44 rounded-xl bg-white p-2"
                  />
                  <p className="mt-2 text-center text-xs text-mute">สแกนเพื่อโอน</p>
                </div>
              ) : null}
            </div>

            {settings.topup_note ? (
              <p className="mt-4 rounded-lg border border-ink-700 bg-ink-850 px-3 py-2.5 text-xs leading-relaxed text-mute">
                {settings.topup_note}
              </p>
            ) : null}
          </section>

          {/* แจ้งโอน */}
          <section className="card mt-6 border-ink-700/70 bg-ink-900/75 backdrop-blur-md">
            <h2 className="text-lg font-bold text-white">2. แจ้งโอนพร้อมแนบสลิป</h2>
            <p className="mt-1 text-sm text-mute">
              กรอกจำนวนเงินที่โอนจริง แล้วแนบสลิป ทางร้านจะตรวจสอบและเติมเครดิตให้
            </p>

            <ActionForm action={requestTopupAction} className="mt-4 space-y-4" resetOnSuccess>
              <div>
                <label className="label" htmlFor="amount">
                  จำนวนเงินที่โอน (บาท) <span className="text-bad">*</span>
                </label>
                <input
                  id="amount"
                  name="amount"
                  type="number"
                  min={1}
                  step="0.01"
                  className="input"
                  placeholder="เช่น 300"
                  required
                />
              </div>

              <SlipInput />

              <div>
                <label className="label" htmlFor="note">
                  หมายเหตุ (ไม่บังคับ)
                </label>
                <input
                  id="note"
                  name="note"
                  className="input"
                  placeholder="เช่น โอนเวลา 14:30 ธนาคารกสิกร"
                />
              </div>

              <SubmitButton className="btn-primary w-full" pendingLabel="กำลังส่ง...">
                แจ้งโอนเงิน
              </SubmitButton>
            </ActionForm>
          </section>
        </>
      )}

      {/* ประวัติการแจ้ง */}
      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold text-white">
          ประวัติการแจ้งโอน
          <span className="ml-2 text-sm font-normal text-mute">{num(requests.length)} รายการ</span>
        </h2>
        {requests.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink-700/70 bg-ink-900/40 px-4 py-10 text-center text-sm text-mute backdrop-blur-sm">
            ยังไม่เคยแจ้งโอนเงิน
          </div>
        ) : (
          <div className="card border-ink-700/70 bg-ink-900/75 backdrop-blur-md">
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>เวลาที่แจ้ง</th>
                    <th className="text-right">จำนวนเงิน</th>
                    <th>สถานะ</th>
                    <th>หมายเหตุจากร้าน</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r) => {
                    const s = STATUS_LABEL[r.status] ?? STATUS_LABEL.pending
                    return (
                      <tr key={r.id}>
                        <td className="whitespace-nowrap text-xs text-mute">
                          {dateTime(r.created_at)}
                        </td>
                        <td className="text-right font-medium text-white">{money(r.amount)}</td>
                        <td>
                          <span className={`chip ${s.cls}`}>{s.text}</span>
                          {r.reviewed_at ? (
                            <span className="mt-1 block text-xs text-mute">
                              {dateTime(r.reviewed_at)}
                            </span>
                          ) : null}
                        </td>
                        <td className="text-xs text-mute">{r.reject_reason ?? '-'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
