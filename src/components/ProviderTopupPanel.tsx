import { ActionForm, ConfirmButton, SubmitButton } from '@/components/ActionForm'
import { SlipInput } from '@/components/SlipInput'
import {
  deleteProviderTopupAction,
  saveProviderTopupAction,
} from '@/lib/actions/providerTopups'
import { dateOnly, money, num } from '@/lib/format'

export type ProviderTopupRow = {
  id: number
  provider_id: number | null
  provider_name: string | null
  amount: number
  bonus: number
  method: string | null
  ref: string | null
  note: string | null
  slip_path: string | null
  topped_up_at: string
}

/**
 * บันทึกและดูประวัติที่ร้านเติมเงินเข้าบัญชีผู้ให้บริการ
 *
 * นี่คือ "เงินที่ร้านจ่ายออกไปจริง" ซึ่งเวลายื่นภาษีต้องใช้เป็นหลักฐานต้นทุน
 * ระบบเดิมเก็บแต่ยอดขายกับต้นทุนต่อชิ้น ไม่มีที่บันทึกว่าจ่ายเงินก้อนไปเมื่อไหร่เท่าไหร่
 */
export function ProviderTopupPanel({
  providers,
  rows,
  monthTotal,
  yearTotal,
  today,
}: {
  providers: Array<{ id: number; name: string }>
  rows: ProviderTopupRow[]
  monthTotal: number
  yearTotal: number
  today: string
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
      <div className="h-fit">
        <ActionForm action={saveProviderTopupAction} className="space-y-3" resetOnSuccess>
          <div>
            <label className="label" htmlFor="pt_provider">
              เติมให้เจ้าไหน
            </label>
            <select id="pt_provider" name="provider_id" className="input" required defaultValue="">
              <option value="" disabled>
                — เลือกผู้ให้บริการ —
              </option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label" htmlFor="pt_amount">
                จำนวนเงินที่โอน
              </label>
              <input
                id="pt_amount"
                name="amount"
                type="number"
                min={0}
                step="0.01"
                className="input"
                placeholder="0.00"
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="pt_bonus">
                โบนัสที่ได้เพิ่ม
              </label>
              <input
                id="pt_bonus"
                name="bonus"
                type="number"
                min={0}
                step="0.01"
                className="input"
                placeholder="0.00"
              />
            </div>
          </div>
          <p className="text-xs leading-relaxed text-mute">
            บางเจ้าเติม 10,000 แล้วได้เครดิต 10,500 — ใส่ 500 ในช่องโบนัส
            เงินที่จ่ายจริงคือ 10,000 ซึ่งเป็นตัวเลขที่ใช้ยื่นภาษี
          </p>

          <div>
            <label className="label" htmlFor="pt_date">
              วันที่โอน
            </label>
            <input
              id="pt_date"
              name="topped_up_at"
              type="date"
              className="input"
              defaultValue={today}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label" htmlFor="pt_method">
                ช่องทาง
              </label>
              <input
                id="pt_method"
                name="method"
                className="input"
                placeholder="เช่น โอนกสิกร"
              />
            </div>
            <div>
              <label className="label" htmlFor="pt_ref">
                เลขอ้างอิง
              </label>
              <input id="pt_ref" name="ref" className="input" placeholder="ถ้ามี" />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="pt_note">
              หมายเหตุ
            </label>
            <input id="pt_note" name="note" className="input" />
          </div>

          <div>
            <p className="label">สลิปการโอน (แนะนำให้แนบไว้เป็นหลักฐาน)</p>
            <SlipInput />
          </div>

          <SubmitButton className="btn-primary w-full" pendingLabel="กำลังบันทึก...">
            บันทึกการเติมเงิน
          </SubmitButton>
        </ActionForm>
      </div>

      <div>
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-ink-700 bg-ink-850 p-3">
            <p className="text-xs font-medium text-mute">จ่ายไปเดือนนี้</p>
            <p className="mt-1 text-2xl font-bold text-white">{money(monthTotal)}</p>
          </div>
          <div className="rounded-xl border border-ink-700 bg-ink-850 p-3">
            <p className="text-xs font-medium text-mute">จ่ายไปทั้งปีนี้</p>
            <p className="mt-1 text-2xl font-bold text-white">{money(yearTotal)}</p>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink-700 px-4 py-10 text-center text-sm text-mute">
            ยังไม่มีประวัติ — บันทึกครั้งแรกจากฟอร์มด้านซ้าย
          </div>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>วันที่</th>
                  <th>ผู้ให้บริการ</th>
                  <th className="text-right">จ่ายจริง</th>
                  <th className="text-right">โบนัส</th>
                  <th className="text-right">ได้เครดิต</th>
                  <th>ช่องทาง / อ้างอิง</th>
                  <th>สลิป</th>
                  <th className="text-right">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap text-xs text-mute">
                      {dateOnly(r.topped_up_at)}
                    </td>
                    <td className="text-slate-200">{r.provider_name ?? '-'}</td>
                    <td className="text-right font-medium text-white">{money(r.amount)}</td>
                    <td className="text-right text-good">
                      {r.bonus > 0 ? money(r.bonus) : '-'}
                    </td>
                    <td className="text-right text-slate-300">{money(r.amount + r.bonus)}</td>
                    <td className="text-xs text-mute">
                      {r.method ? <span className="block">{r.method}</span> : null}
                      {r.ref ? <span className="block font-mono">{r.ref}</span> : null}
                      {r.note ? <span className="block">{r.note}</span> : null}
                    </td>
                    <td>
                      {r.slip_path ? (
                        <a
                          href={`/provider-topup-slip/${r.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-brand-400 underline"
                        >
                          ดูสลิป
                        </a>
                      ) : (
                        <span className="text-xs text-mute">-</span>
                      )}
                    </td>
                    <td className="text-right">
                      <form action={deleteProviderTopupAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <ConfirmButton
                          message={`ลบรายการเติมเงิน ${money(r.amount)} บาท วันที่ ${dateOnly(r.topped_up_at)}?`}
                        >
                          ลบ
                        </ConfirmButton>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 text-xs leading-relaxed text-mute">
          แสดง {num(rows.length)} รายการล่าสุด · ตัวเลขนี้คือ
          <b className="text-slate-200">เงินสดที่จ่ายออกไปซื้อเครดิตมาไว้ขาย</b>{' '}
          ซึ่งคนละอย่างกับ &quot;ต้นทุนขาย&quot; ในรายงานกำไร (ต้นทุนขายจะนับเฉพาะส่วนที่ขายออกไปแล้ว)
          · เวลายื่นภาษีอย่าเอาสองตัวนี้มาบวกกัน จะกลายเป็นนับต้นทุนซ้ำ
        </p>
      </div>
    </div>
  )
}
