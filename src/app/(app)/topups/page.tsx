import Link from 'next/link'
import { q, q1 } from '@/lib/db'
import { requirePage } from '@/lib/auth'
import { approveTopupAction, rejectTopupAction } from '@/lib/actions/topups'
import { dateTime, money, num } from '@/lib/format'
import { ActionForm, SubmitButton } from '@/components/ActionForm'
import { AutoRefresh } from '@/components/AutoRefresh'
import { Badge, Empty, MoneyStat, PageHeader, SectionTitle } from '@/components/ui'

export const dynamic = 'force-dynamic'

type RequestRow = {
  id: number
  customer_id: number
  customer_name: string
  customer_credit: number
  amount: number
  slip_path: string | null
  note: string | null
  status: string
  reject_reason: string | null
  created_at: string
  reviewed_at: string | null
  reviewer: string | null
}

export default async function TopupsPage() {
  await requirePage('topups')

  const [requests, totals] = await Promise.all([
    q<RequestRow>(
      `select r.id, r.customer_id, c.name as customer_name, c.credit::float8 as customer_credit,
              r.amount::float8 as amount, r.slip_path, r.note, r.status, r.reject_reason,
              r.created_at, r.reviewed_at, p.display_name as reviewer
         from credit_requests r
         join customers c on c.id = r.customer_id
         left join profiles p on p.id = r.reviewed_by
        order by (r.status = 'pending') desc, r.created_at desc
        limit 200`
    ),
    q1<{ pending_count: number; pending_amount: number; approved_today: number }>(
      `select count(*) filter (where status = 'pending')::int as pending_count,
              coalesce(sum(amount) filter (where status = 'pending'), 0)::float8 as pending_amount,
              coalesce(sum(amount) filter (
                where status = 'approved'
                  and (reviewed_at at time zone 'Asia/Bangkok')::date
                      = (now() at time zone 'Asia/Bangkok')::date
              ), 0)::float8 as approved_today
         from credit_requests`
    ),
  ])

  const t = totals ?? { pending_count: 0, pending_amount: 0, approved_today: 0 }

  return (
    <>
      <PageHeader
        title="อนุมัติเติมเครดิต"
        subtitle="ลูกค้าโอนเงินแล้วแจ้งพร้อมสลิปผ่านหน้าเว็บ — ตรวจสลิปแล้วกดอนุมัติเพื่อเติมเครดิตให้"
      >
        <AutoRefresh seconds={20} />
        <Link href="/storefront" className="btn-ghost">
          ตั้งค่าเลขบัญชี
        </Link>
      </PageHeader>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="card">
          <p className="text-xs font-medium text-mute">รออนุมัติ</p>
          <p
            className={`mt-2 text-2xl font-bold ${t.pending_count > 0 ? 'text-warn' : 'text-good'}`}
          >
            {num(t.pending_count)}
            <span className="ml-1 text-sm font-medium text-mute">รายการ</span>
          </p>
        </div>
        <MoneyStat label="ยอดที่รออนุมัติ" amount={t.pending_amount} tone="warn" />
        <MoneyStat label="อนุมัติไปแล้ววันนี้" amount={t.approved_today} tone="good" />
      </div>

      <div className="card">
        <SectionTitle right={<span className="text-xs text-mute">{num(requests.length)} รายการ</span>}>
          รายการแจ้งโอนเงิน
        </SectionTitle>

        {requests.length === 0 ? (
          <Empty>
            ยังไม่มีลูกค้าแจ้งโอนเงินเข้ามา — อย่าลืมตั้งเลขบัญชีที่{' '}
            <Link href="/storefront" className="text-brand-400 underline">
              จัดการหน้าเว็บไซต์
            </Link>{' '}
            ไม่งั้นลูกค้าจะไม่รู้ว่าต้องโอนไปไหน
          </Empty>
        ) : (
          <div className="space-y-3">
            {requests.map((r) => (
              <div
                key={r.id}
                className={`rounded-xl border p-4 ${
                  r.status === 'pending'
                    ? 'border-warn/40 bg-warn/5'
                    : 'border-ink-700 bg-ink-850'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-white">{r.customer_name}</span>
                      {r.status === 'pending' ? (
                        <Badge tone="warn">รออนุมัติ</Badge>
                      ) : r.status === 'approved' ? (
                        <Badge tone="good">อนุมัติแล้ว</Badge>
                      ) : (
                        <Badge tone="bad">ปฏิเสธ</Badge>
                      )}
                    </p>
                    <p className="mt-1 text-xs text-mute">
                      แจ้งเมื่อ {dateTime(r.created_at)} · เครดิตปัจจุบัน{' '}
                      {money(r.customer_credit)} บาท
                    </p>
                    {r.note ? (
                      <p className="mt-1 text-xs text-mute">📝 {r.note}</p>
                    ) : null}
                    {r.reviewed_at ? (
                      <p className="mt-1 text-xs text-mute">
                        ดำเนินการ {dateTime(r.reviewed_at)}
                        {r.reviewer ? ` โดย ${r.reviewer}` : ''}
                        {r.reject_reason ? ` · เหตุผล: ${r.reject_reason}` : ''}
                      </p>
                    ) : null}
                  </div>

                  <div className="text-right">
                    <p className="text-2xl font-bold text-white">{money(r.amount)}</p>
                    <p className="text-xs text-mute">บาท</p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {r.slip_path ? (
                    <a
                      href={`/topup-slip/${r.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-ghost btn-sm"
                    >
                      🧾 ดูสลิป
                    </a>
                  ) : (
                    <span className="text-xs text-bad">ไม่มีสลิปแนบ</span>
                  )}
                  <Link href={`/customers?q=${encodeURIComponent(r.customer_name)}`} className="btn-ghost btn-sm">
                    ดูข้อมูลลูกค้า
                  </Link>

                  {r.status === 'pending' ? (
                    <>
                      <ActionForm action={approveTopupAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <SubmitButton className="btn-primary btn-sm" pendingLabel="กำลังอนุมัติ...">
                          ✓ อนุมัติและเติมเครดิต
                        </SubmitButton>
                      </ActionForm>

                      <ActionForm action={rejectTopupAction} className="flex-1">
                        <div className="flex flex-wrap gap-2">
                          <input type="hidden" name="id" value={r.id} />
                          <input
                            name="reject_reason"
                            className="input w-auto flex-1 py-1 text-xs"
                            placeholder="เหตุผลที่ปฏิเสธ เช่น สลิปไม่ชัด ยอดไม่ตรง"
                          />
                          <SubmitButton className="btn-danger btn-sm" pendingLabel="...">
                            ปฏิเสธ
                          </SubmitButton>
                        </div>
                      </ActionForm>
                    </>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
