import Link from 'next/link'
import { q, q1 } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { deleteExpenseAction, saveExpenseAction } from '@/lib/actions/expenses'
import { EXPENSE_CATEGORIES } from '@/lib/constants'
import { dateOnly, money, monthLabel, num, recentMonths, safeMonth, todayISO } from '@/lib/format'
import { ActionForm, ConfirmButton, SubmitButton } from '@/components/ActionForm'
import { RankBars } from '@/components/Charts'
import { MonthPicker } from '@/components/MonthPicker'
import { Empty, MoneyStat, PageHeader, SectionTitle } from '@/components/ui'

export const dynamic = 'force-dynamic'

type ExpenseRow = {
  id: number
  spent_on: string
  category: string
  title: string
  amount: number
  note: string | null
  created_by_name: string | null
}

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; edit?: string }>
}) {
  await requireAdmin()
  const { month: monthParam, edit } = await searchParams
  const month = safeMonth(monthParam)
  const monthStart = `${month}-01`

  const [rows, byCategory, totals, editing] = await Promise.all([
    q<ExpenseRow>(
      `select e.id, to_char(e.spent_on, 'YYYY-MM-DD') as spent_on, e.category, e.title,
              e.amount::float8 as amount, e.note, u.display_name as created_by_name
         from expenses e left join users u on u.id = e.created_by
        where e.spent_on >= $1::date and e.spent_on < $1::date + interval '1 month'
        order by e.spent_on desc, e.id desc`,
      [monthStart]
    ),
    q<{ label: string; value: number }>(
      `select category as label, sum(amount)::float8 as value
         from expenses
        where spent_on >= $1::date and spent_on < $1::date + interval '1 month'
        group by 1 order by value desc`,
      [monthStart]
    ),
    q1<{ expense: number; revenue: number; profit: number; prev_expense: number }>(
      `select
         coalesce((select sum(amount) from expenses
                    where spent_on >= $1::date
                      and spent_on < $1::date + interval '1 month'), 0)::float8 as expense,
         coalesce((select sum(amount) from expenses
                    where spent_on >= $1::date - interval '1 month'
                      and spent_on < $1::date), 0)::float8 as prev_expense,
         coalesce((select sum(total) from sales
                    where status = 'paid'
                      and (sold_at at time zone 'Asia/Bangkok')::date >= $1::date
                      and (sold_at at time zone 'Asia/Bangkok')::date
                          < $1::date + interval '1 month'), 0)::float8 as revenue,
         coalesce((select sum(profit) from sales
                    where status = 'paid'
                      and (sold_at at time zone 'Asia/Bangkok')::date >= $1::date
                      and (sold_at at time zone 'Asia/Bangkok')::date
                          < $1::date + interval '1 month'), 0)::float8 as profit`,
      [monthStart]
    ),
    edit
      ? q1<ExpenseRow>(
          `select id, to_char(spent_on, 'YYYY-MM-DD') as spent_on, category, title,
                  amount::float8 as amount, note
             from expenses where id = $1`,
          [Number(edit)]
        )
      : Promise.resolve(null),
  ])

  const t = totals ?? { expense: 0, revenue: 0, profit: 0, prev_expense: 0 }
  const net = t.profit - t.expense
  const diff = t.expense - t.prev_expense

  return (
    <>
      <PageHeader
        title="ค่าใช้จ่ายรายเดือน"
        subtitle={`ต้นทุนคงที่และรายจ่ายอื่นของ ${monthLabel(month)} — นำไปหักกำไรขั้นต้นเป็นกำไรสุทธิ`}
      >
        <MonthPicker value={month} months={recentMonths(todayISO().slice(0, 7), 24)} />
      </PageHeader>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MoneyStat label="ยอดขายเดือนนี้" amount={t.revenue} />
        <MoneyStat label="กำไรขั้นต้น (ยอดขาย − ทุนสินค้า)" amount={t.profit} tone="good" />
        <MoneyStat
          label="ค่าใช้จ่ายเดือนนี้"
          amount={t.expense}
          tone="warn"
          hint={
            t.prev_expense > 0
              ? `${diff >= 0 ? '▲' : '▼'} ${money(Math.abs(diff))} จากเดือนก่อน`
              : undefined
          }
        />
        <MoneyStat
          label="กำไรสุทธิ"
          amount={net}
          tone={net >= 0 ? 'good' : 'bad'}
          hint="กำไรขั้นต้น − ค่าใช้จ่าย"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <div className="space-y-6">
          <div className="card h-fit">
            <SectionTitle
              right={
                editing ? (
                  <Link href={`/expenses?month=${month}`} className="text-xs text-brand-400">
                    ยกเลิกการแก้ไข
                  </Link>
                ) : undefined
              }
            >
              {editing ? 'แก้ไขค่าใช้จ่าย' : 'บันทึกค่าใช้จ่าย'}
            </SectionTitle>

            <ActionForm
              key={editing?.id ?? 'new'}
              action={saveExpenseAction}
              className="space-y-4"
              resetOnSuccess={!editing}
            >
              {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
              <div>
                <label className="label" htmlFor="spent_on">
                  วันที่จ่าย
                </label>
                <input
                  id="spent_on"
                  name="spent_on"
                  type="date"
                  className="input"
                  defaultValue={editing?.spent_on ?? todayISO()}
                  required
                />
              </div>
              <div>
                <label className="label" htmlFor="category">
                  หมวดหมู่
                </label>
                <select
                  id="category"
                  name="category"
                  className="input"
                  defaultValue={editing?.category ?? EXPENSE_CATEGORIES[0]}
                >
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="title">
                  รายการ
                </label>
                <input
                  id="title"
                  name="title"
                  className="input"
                  defaultValue={editing?.title ?? ''}
                  placeholder="เช่น ค่าเช่าร้านเดือนสิงหาคม"
                  required
                />
              </div>
              <div>
                <label className="label" htmlFor="amount">
                  จำนวนเงิน (บาท)
                </label>
                <input
                  id="amount"
                  name="amount"
                  type="number"
                  min={0}
                  step="0.01"
                  className="input"
                  defaultValue={editing?.amount ?? ''}
                  required
                />
              </div>
              <div>
                <label className="label" htmlFor="note">
                  หมายเหตุ
                </label>
                <input
                  id="note"
                  name="note"
                  className="input"
                  defaultValue={editing?.note ?? ''}
                  placeholder="ไม่บังคับ"
                />
              </div>
              <SubmitButton className="btn-primary w-full">
                {editing ? 'บันทึกการแก้ไข' : 'บันทึกค่าใช้จ่าย'}
              </SubmitButton>
            </ActionForm>
          </div>

          <div className="card">
            <SectionTitle>แยกตามหมวดหมู่</SectionTitle>
            <RankBars data={byCategory} />
          </div>
        </div>

        <div className="card">
          <SectionTitle
            right={<span className="text-xs text-mute">{num(rows.length)} รายการ</span>}
          >
            รายการค่าใช้จ่าย {monthLabel(month)}
          </SectionTitle>
          {rows.length === 0 ? (
            <Empty>ยังไม่มีค่าใช้จ่ายในเดือนนี้</Empty>
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>วันที่</th>
                    <th>หมวดหมู่</th>
                    <th>รายการ</th>
                    <th className="text-right">จำนวนเงิน</th>
                    <th>ผู้บันทึก</th>
                    <th className="text-right">จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.id}>
                      <td className="whitespace-nowrap text-xs">
                        {dateOnly(`${e.spent_on}T00:00:00+07:00`)}
                      </td>
                      <td className="text-slate-300">{e.category}</td>
                      <td>
                        <span className="block text-white">{e.title}</span>
                        {e.note ? <span className="block text-xs text-mute">{e.note}</span> : null}
                      </td>
                      <td className="text-right font-medium text-warn">{money(e.amount)}</td>
                      <td className="text-xs text-mute">{e.created_by_name ?? '-'}</td>
                      <td>
                        <div className="flex justify-end gap-1.5">
                          <Link
                            href={`/expenses?month=${month}&edit=${e.id}`}
                            className="btn-ghost btn-sm"
                          >
                            แก้ไข
                          </Link>
                          <form action={deleteExpenseAction}>
                            <input type="hidden" name="id" value={e.id} />
                            <ConfirmButton message={`ลบค่าใช้จ่าย "${e.title}"?`}>ลบ</ConfirmButton>
                          </form>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} className="text-right font-medium text-mute">
                      รวมทั้งเดือน
                    </td>
                    <td className="text-right text-lg font-bold text-warn">{money(t.expense)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
