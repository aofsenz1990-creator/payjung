import 'server-only'
import { q } from '@/lib/db'
import {
  adjustCreditAction,
  createCustomerLoginAction,
  toggleCustomerWebAction,
} from '@/lib/actions/shop'
import { money, num } from '@/lib/format'
import { ActionForm, SubmitButton } from '@/components/ActionForm'
import { Badge, Empty, SectionTitle } from '@/components/ui'

export type CreditCustomer = {
  id: number
  name: string
  credit: number
  web_enabled: boolean
  has_login: boolean
}

export async function loadCreditCustomers() {
  return q<CreditCustomer>(
    `select id, name, credit::float8 as credit, web_enabled,
            (auth_user_id is not null) as has_login
       from customers order by credit desc, name`
  )
}

/** เติม/ตัดเครดิต และเปิดบัญชีให้ลูกค้าเข้าหน้าเว็บ */
export function CreditPanel({
  customers,
  isAdmin,
}: {
  customers: CreditCustomer[]
  isAdmin: boolean
}) {
  const totalCredit = customers.reduce((a, c) => a + c.credit, 0)
  const webUsers = customers.filter((c) => c.web_enabled).length

  return (
    <div className="card">
      <SectionTitle
        right={
          <span className="text-xs text-mute">
            เครดิตค้างในระบบรวม {money(totalCredit)} บาท · เข้าเว็บได้ {num(webUsers)} คน
          </span>
        }
      >
        เครดิตลูกค้า
      </SectionTitle>

      <p className="mb-5 text-xs leading-relaxed text-mute">
        ลูกค้าจ่ายเงินให้ร้านแล้วร้านเติมเครดิตให้ที่นี่ เวลาลูกค้ากดซื้อบนหน้าเว็บ
        ระบบจะตัดเครดิตอัตโนมัติและออกบิลสถานะ “รอดำเนินการ” ให้ร้านไปเติมเกมให้
      </p>

      {customers.length === 0 ? (
        <Empty>ยังไม่มีลูกค้าในระบบ — เพิ่มลูกค้าจากฟอร์มด้านซ้ายก่อน</Empty>
      ) : (
        <div className="space-y-3">
          {customers.map((c) => (
            <div key={c.id} className="rounded-xl border border-ink-700 bg-ink-850 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-medium text-white">{c.name}</span>
                  {c.web_enabled ? (
                    <Badge tone="good">เข้าเว็บได้</Badge>
                  ) : c.has_login ? (
                    <Badge>ปิดใช้งานเว็บ</Badge>
                  ) : (
                    <Badge tone="warn">ยังไม่มีบัญชีเว็บ</Badge>
                  )}
                </div>
                <span className="text-sm">
                  <span className="text-mute">เครดิต </span>
                  <span className={`font-bold ${c.credit > 0 ? 'text-good' : 'text-mute'}`}>
                    {money(c.credit)}
                  </span>
                  <span className="text-xs text-mute"> บาท</span>
                </span>
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                {/* เติม / ตัดเครดิต */}
                <ActionForm action={adjustCreditAction} className="space-y-2" resetOnSuccess>
                  <input type="hidden" name="customer_id" value={c.id} />
                  <div className="flex flex-wrap gap-2">
                    <input
                      name="amount"
                      type="number"
                      min={1}
                      step="0.01"
                      className="input w-28"
                      placeholder="จำนวน"
                      required
                    />
                    <select name="kind" className="input w-auto" defaultValue="topup">
                      <option value="topup">เติมเครดิต</option>
                      <option value="deduct">ตัดเครดิต</option>
                    </select>
                    <input name="note" className="input flex-1" placeholder="หมายเหตุ เช่น โอนมา 500" />
                    <SubmitButton className="btn-primary btn-sm">บันทึก</SubmitButton>
                  </div>
                </ActionForm>

                {/* บัญชีเข้าเว็บ */}
                {isAdmin ? (
                  <div className="flex flex-wrap items-start gap-2">
                    <ActionForm action={createCustomerLoginAction} className="flex-1" resetOnSuccess>
                      <input type="hidden" name="customer_id" value={c.id} />
                      <div className="flex flex-wrap gap-2">
                        <input
                          name="email"
                          type="email"
                          className="input flex-1"
                          placeholder="อีเมลสำหรับเข้าเว็บ"
                          autoComplete="off"
                          required
                        />
                        <input
                          name="password"
                          type="password"
                          className="input w-36"
                          placeholder="รหัสผ่าน"
                          autoComplete="new-password"
                          minLength={8}
                          required
                        />
                        <SubmitButton className="btn-ghost btn-sm">
                          {c.has_login ? 'ตั้งใหม่' : 'เปิดบัญชี'}
                        </SubmitButton>
                      </div>
                    </ActionForm>
                    {c.has_login ? (
                      <form action={toggleCustomerWebAction}>
                        <input type="hidden" name="id" value={c.id} />
                        <button type="submit" className="btn-ghost btn-sm">
                          {c.web_enabled ? 'ปิดเว็บ' : 'เปิดเว็บ'}
                        </button>
                      </form>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
