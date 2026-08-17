import Link from 'next/link'
import { q, q1 } from '@/lib/db'
import { requirePage } from '@/lib/auth'
import { deleteCustomerAction, saveCustomerAction } from '@/lib/actions/catalog'
import { dateOnly, money, num } from '@/lib/format'
import { ActionForm, ConfirmButton, SubmitButton } from '@/components/ActionForm'
import { CreditPanel, loadCreditCustomers } from '@/components/CreditPanel'
import { SendMessageForm } from '@/components/SendMessageForm'
import { Empty, PageHeader, SectionTitle } from '@/components/ui'

export const dynamic = 'force-dynamic'

type CustomerRow = {
  id: number
  name: string
  phone: string | null
  contact: string | null
  game_uid: string | null
  note: string | null
  web_enabled: boolean | null
  orders: number
  spent: number
  last_buy: string | null
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; q?: string }>
}) {
  const user = await requirePage('customers')
  const isAdmin = user.role === 'admin'
  const { edit, q: keyword } = await searchParams
  const search = (keyword ?? '').trim()

  const [customers, editing, creditCustomers] = await Promise.all([
    q<CustomerRow>(
      `select c.id, c.name, c.phone, c.contact, c.game_uid, c.note, c.web_enabled,
              coalesce(t.orders, 0)::int as orders,
              coalesce(t.spent, 0)::float8 as spent,
              t.last_buy
         from customers c
         left join (
           select customer_id, count(*) as orders, sum(total) as spent, max(sold_at) as last_buy
             from sales where status = 'paid' group by customer_id
         ) t on t.customer_id = c.id
        ${search ? `where c.name ilike $1 or c.phone ilike $1 or c.contact ilike $1 or c.game_uid ilike $1` : ''}
        order by coalesce(t.spent, 0) desc, c.name`,
      search ? [`%${search}%`] : []
    ),
    edit
      ? q1<CustomerRow>(
          'select id, name, phone, contact, game_uid, note from customers where id = $1',
          [Number(edit)]
        )
      : Promise.resolve(null),
    loadCreditCustomers(),
  ])

  return (
    <>
      <PageHeader
        title="รายชื่อลูกค้า"
        subtitle="เก็บชื่อ ช่องทางติดต่อ และไอดีเกม เพื่อเลือกตอนลงยอดขายได้ทันที"
      />

      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <div className="card h-fit">
          <SectionTitle
            right={
              editing ? (
                <Link href="/customers" className="text-xs text-brand-400">
                  ยกเลิกการแก้ไข
                </Link>
              ) : undefined
            }
          >
            {editing ? `แก้ไข: ${editing.name}` : 'เพิ่มลูกค้าใหม่'}
          </SectionTitle>

          <ActionForm
            key={editing?.id ?? 'new'}
            action={saveCustomerAction}
            className="space-y-4"
            resetOnSuccess={!editing}
          >
            {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
            <div>
              <label className="label" htmlFor="name">
                ชื่อลูกค้า
              </label>
              <input
                id="name"
                name="name"
                className="input"
                defaultValue={editing?.name ?? ''}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="phone">
                เบอร์โทร
              </label>
              <input
                id="phone"
                name="phone"
                className="input"
                defaultValue={editing?.phone ?? ''}
                placeholder="08x-xxx-xxxx"
              />
            </div>
            <div>
              <label className="label" htmlFor="contact">
                ช่องทางติดต่อ (LINE / Facebook)
              </label>
              <input
                id="contact"
                name="contact"
                className="input"
                defaultValue={editing?.contact ?? ''}
              />
            </div>
            <div>
              <label className="label" htmlFor="game_uid">
                ไอดีเกมที่ใช้ประจำ
              </label>
              <input
                id="game_uid"
                name="game_uid"
                className="input"
                defaultValue={editing?.game_uid ?? ''}
                placeholder="เช่น 123456789"
              />
            </div>
            <div>
              <label className="label" htmlFor="note">
                หมายเหตุ
              </label>
              <input id="note" name="note" className="input" defaultValue={editing?.note ?? ''} />
            </div>
            <SubmitButton className="btn-primary w-full">
              {editing ? 'บันทึกการแก้ไข' : 'เพิ่มลูกค้า'}
            </SubmitButton>
          </ActionForm>
        </div>

        <div className="card">
          <SectionTitle
            right={<span className="text-xs text-mute">{num(customers.length)} คน</span>}
          >
            ลูกค้าทั้งหมด
          </SectionTitle>

          <form method="get" className="mb-4 flex gap-2">
            <input
              name="q"
              className="input"
              defaultValue={search}
              placeholder="ค้นหาชื่อ เบอร์โทร LINE หรือไอดีเกม"
            />
            <button type="submit" className="btn-ghost">
              ค้นหา
            </button>
          </form>

          {customers.length === 0 ? (
            <Empty>
              {search ? 'ไม่พบลูกค้าตามคำค้นหา' : 'ยังไม่มีลูกค้า เพิ่มคนแรกจากฟอร์มด้านซ้าย'}
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>ชื่อ</th>
                    <th>ติดต่อ</th>
                    <th>ไอดีเกม</th>
                    <th className="text-right">จำนวนบิล</th>
                    <th className="text-right">ยอดซื้อสะสม</th>
                    <th>ซื้อล่าสุด</th>
                    <th className="text-right">จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <span className="block font-medium text-white">{c.name}</span>
                        {c.note ? <span className="block text-xs text-mute">{c.note}</span> : null}
                      </td>
                      <td className="text-slate-300">
                        {c.phone ? <span className="block">{c.phone}</span> : null}
                        {c.contact ? (
                          <span className="block text-xs text-mute">{c.contact}</span>
                        ) : null}
                        {!c.phone && !c.contact ? '-' : null}
                      </td>
                      <td className="font-mono text-xs text-mute">{c.game_uid ?? '-'}</td>
                      <td className="text-right">{num(c.orders)}</td>
                      <td className="text-right font-medium text-white">{money(c.spent)}</td>
                      <td className="whitespace-nowrap text-xs text-mute">
                        {c.last_buy ? dateOnly(c.last_buy) : '-'}
                      </td>
                      <td>
                        <div className="flex justify-end gap-1.5">
                          <Link
                            href={`/history?customer=${c.id}&month=all`}
                            className="btn-ghost btn-sm"
                          >
                            ประวัติ
                          </Link>
                          <Link href={`/customers?edit=${c.id}`} className="btn-ghost btn-sm">
                            แก้ไข
                          </Link>
                          {/* ส่งข้อความเข้ากล่องข้อความบนหน้าเว็บของลูกค้า */}
                          {c.web_enabled ? (
                            <SendMessageForm customerId={c.id} label="ส่งข้อความ" />
                          ) : null}
                          {isAdmin ? (
                            <form action={deleteCustomerAction}>
                              <input type="hidden" name="id" value={c.id} />
                              <ConfirmButton
                                message={`ลบลูกค้า "${c.name}"? บิลเก่าจะยังอยู่แต่จะกลายเป็นลูกค้าทั่วไป`}
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

      <div className="mt-6">
        <CreditPanel customers={creditCustomers} isAdmin={isAdmin} />
      </div>
    </>
  )
}
