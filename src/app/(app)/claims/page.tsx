import { q, q1 } from '@/lib/db'
import { requirePage } from '@/lib/auth'
import { deleteClaimAction, markClaimPaidAction, saveClaimAction } from '@/lib/actions/claims'
import { CLAIM_CHANNELS } from '@/lib/constants'
import { dateTime, money, num } from '@/lib/format'
import { ActionForm, ConfirmButton, SubmitButton } from '@/components/ActionForm'
import { SlipInput } from '@/components/SlipInput'
import { Badge, Empty, MoneyStat, PageHeader, SectionTitle } from '@/components/ui'

export const dynamic = 'force-dynamic'

type ClaimRow = {
  id: number
  customer_name: string
  contact_channel: string | null
  contact_value: string | null
  amount: number
  game_name: string | null
  game: string | null
  slip_path: string | null
  note: string | null
  status: string
  created_at: string
  paid_at: string | null
  created_by_name: string | null
}

export default async function ClaimsPage() {
  const user = await requirePage('claims')
  const isAdmin = user.role === 'admin'

  const [claims, customers, games, totals] = await Promise.all([
    q<ClaimRow>(
      `select c.id, c.customer_name, c.contact_channel, c.contact_value,
              c.amount::float8 as amount, c.game_name, g.name as game, c.slip_path, c.note,
              c.status, c.created_at, c.paid_at, p.display_name as created_by_name
         from claims c
         left join games g on g.id = c.game_id
         left join profiles p on p.id = c.created_by
        order by (c.status = 'pending') desc, c.created_at desc
        limit 200`
    ),
    q<{ id: number; name: string; phone: string | null }>(
      'select id, name, phone from customers order by name'
    ),
    q<{ id: number; name: string }>('select id, name from games where is_active order by name'),
    q1<{ pending_count: number; pending_amount: number; paid_amount: number }>(
      `select count(*) filter (where status = 'pending')::int as pending_count,
              coalesce(sum(amount) filter (where status = 'pending'), 0)::float8 as pending_amount,
              coalesce(sum(amount) filter (where status = 'paid'), 0)::float8 as paid_amount
         from claims`
    ),
  ])

  const t = totals ?? { pending_count: 0, pending_amount: 0, paid_amount: 0 }

  return (
    <>
      <PageHeader
        title="เคลม / คืนเงิน"
        subtitle="ใช้เมื่อเติมเกมให้ลูกค้าไม่สำเร็จแล้วต้องโอนเงินคืน — บันทึกไว้กันลืมและตรวจย้อนหลังได้"
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="card">
          <p className="text-xs font-medium text-mute">รอโอนคืน</p>
          <p className={`mt-2 text-2xl font-bold ${t.pending_count > 0 ? 'text-warn' : 'text-good'}`}>
            {num(t.pending_count)}
            <span className="ml-1 text-sm font-medium text-mute">รายการ</span>
          </p>
        </div>
        <MoneyStat label="ยอดที่ต้องโอนคืน" amount={t.pending_amount} tone="warn" />
        <MoneyStat label="โอนคืนไปแล้วทั้งหมด" amount={t.paid_amount} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[24rem_1fr]">
        <div className="card h-fit">
          <SectionTitle>บันทึกเคลมใหม่</SectionTitle>
          <ActionForm action={saveClaimAction} className="space-y-4" resetOnSuccess>
            <div>
              <label className="label" htmlFor="customer_name">
                ชื่อลูกค้า <span className="text-bad">*</span>
              </label>
              <input
                id="customer_name"
                name="customer_name"
                className="input"
                list="claim-customers"
                autoComplete="off"
                placeholder="พิมพ์ชื่อ หรือเลือกจากรายชื่อเดิม"
                required
              />
              <datalist id="claim-customers">
                {customers.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.phone ?? ''}
                  </option>
                ))}
              </datalist>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="contact_channel">
                  ช่องทางติดต่อ
                </label>
                <select
                  id="contact_channel"
                  name="contact_channel"
                  className="input"
                  defaultValue=""
                >
                  <option value="">— ไม่ระบุ —</option>
                  {CLAIM_CHANNELS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="contact_value">
                  ชื่อ/ไอดีที่ติดต่อ
                </label>
                <input
                  id="contact_value"
                  name="contact_value"
                  className="input"
                  placeholder="เช่น @lineid"
                />
              </div>
            </div>

            <div>
              <label className="label" htmlFor="amount">
                จำนวนเงินที่ต้องคืน (บาท) <span className="text-bad">*</span>
              </label>
              <input
                id="amount"
                name="amount"
                type="number"
                min={1}
                step="0.01"
                className="input"
                required
              />
            </div>

            <div>
              <label className="label" htmlFor="game_id">
                เกมที่เติมไม่สำเร็จ <span className="text-bad">*</span>
              </label>
              <select id="game_id" name="game_id" className="input" defaultValue="">
                <option value="">— เลือกจากรายชื่อเกม —</option>
                {games.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <input
                name="game_name"
                className="input mt-2"
                placeholder="หรือพิมพ์ชื่อเกมเองถ้าไม่มีในรายการ"
              />
            </div>

            <SlipInput />
            <p className="-mt-2 text-xs text-mute">
              แนบสลิปตอนโอนคืนได้เลย หรือเว้นไว้ก่อนแล้วมาแนบทีหลังตอนกด “โอนคืนแล้ว”
            </p>

            <div>
              <label className="label" htmlFor="note">
                หมายเหตุ
              </label>
              <input
                id="note"
                name="note"
                className="input"
                placeholder="เช่น ไอดีผิด เติมไม่เข้า"
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-200">
              <input
                type="checkbox"
                name="status"
                value="paid"
                className="size-4 rounded border-ink-600 bg-ink-850"
              />
              โอนคืนให้ลูกค้าเรียบร้อยแล้ว
            </label>

            <SubmitButton className="btn-primary w-full">บันทึกเคลม</SubmitButton>
          </ActionForm>
        </div>

        <div className="card">
          <SectionTitle right={<span className="text-xs text-mute">{num(claims.length)} รายการ</span>}>
            รายการเคลม
          </SectionTitle>
          {claims.length === 0 ? (
            <Empty>ยังไม่มีรายการเคลม — ดีแล้ว แปลว่าเติมสำเร็จทุกบิล 👍</Empty>
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>เวลา</th>
                    <th>ลูกค้า</th>
                    <th>ติดต่อ</th>
                    <th>เกม</th>
                    <th className="text-right">จำนวนเงิน</th>
                    <th>สลิป</th>
                    <th>สถานะ</th>
                    <th className="text-right">จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {claims.map((c) => (
                    <tr key={c.id} className={c.status === 'pending' ? 'bg-warn/5' : undefined}>
                      <td className="whitespace-nowrap text-xs text-mute">
                        {dateTime(c.created_at)}
                        {c.created_by_name ? (
                          <span className="block">โดย {c.created_by_name}</span>
                        ) : null}
                      </td>
                      <td>
                        <span className="block font-medium text-white">{c.customer_name}</span>
                        {c.note ? <span className="block text-xs text-mute">{c.note}</span> : null}
                      </td>
                      <td className="text-xs">
                        {c.contact_channel ? (
                          <span className="block text-brand-400">{c.contact_channel}</span>
                        ) : null}
                        <span className="block text-mute">{c.contact_value ?? '-'}</span>
                      </td>
                      <td className="text-slate-300">{c.game ?? c.game_name ?? '-'}</td>
                      <td className="text-right font-medium text-warn">{money(c.amount)}</td>
                      <td>
                        {c.slip_path ? (
                          <a
                            href={`/claim-slip/${c.id}`}
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
                      <td>
                        {c.status === 'paid' ? (
                          <Badge tone="good">โอนคืนแล้ว</Badge>
                        ) : (
                          <Badge tone="warn">รอโอนคืน</Badge>
                        )}
                        {c.paid_at ? (
                          <span className="mt-1 block text-xs text-mute">
                            {dateTime(c.paid_at)}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <div className="flex justify-end gap-1.5">
                          {c.status === 'pending' ? (
                            <ActionForm action={markClaimPaidAction}>
                              <input type="hidden" name="id" value={c.id} />
                              <SubmitButton className="btn-ghost btn-sm">โอนคืนแล้ว</SubmitButton>
                            </ActionForm>
                          ) : null}
                          {isAdmin ? (
                            <form action={deleteClaimAction}>
                              <input type="hidden" name="id" value={c.id} />
                              <ConfirmButton
                                message={`ลบรายการเคลมของ "${c.customer_name}"?`}
                              >
                                ลบ
                              </ConfirmButton>
                            </form>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
