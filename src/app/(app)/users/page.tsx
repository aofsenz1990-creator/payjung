import { q } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import {
  changeRoleAction,
  createUserAction,
  deleteUserAction,
  resetPasswordAction,
  setPagesAction,
  toggleUserAction,
} from '@/lib/actions/users'
import { dateOnly, num } from '@/lib/format'
import { ASSIGNABLE_PAGES, DEFAULT_STAFF_PAGES } from '@/lib/pages'
import { ActionForm, ConfirmButton, SubmitButton } from '@/components/ActionForm'
import { Badge, Empty, PageHeader, SectionTitle } from '@/components/ui'

export const dynamic = 'force-dynamic'

type UserRow = {
  id: string
  email: string | null
  display_name: string
  role: string
  is_active: boolean
  created_at: string
  allowed_pages: string | null
  sales: number
}

export default async function UsersPage() {
  const me = await requireAdmin()

  const users = await q<UserRow>(
    `select p.id, p.email, p.display_name, p.role, p.is_active, p.created_at,
            case when p.allowed_pages is null then null
                 else array_to_string(p.allowed_pages, ',') end as allowed_pages,
            (select count(*) from sales s where s.created_by = p.id)::int as sales
       from profiles p order by p.role, p.display_name`
  )

  const staff = users.filter((u) => u.role !== 'admin')

  return (
    <>
      <PageHeader
        title="ผู้ใช้งานระบบ"
        subtitle="จัดการบัญชีเข้าใช้งานและสิทธิ์ — ผู้ดูแลระบบเห็นต้นทุน กำไร และค่าใช้จ่าย ส่วนพนักงานเห็นเฉพาะยอดขาย"
      />

      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <div className="space-y-6">
          <div className="card h-fit">
            <SectionTitle>เพิ่มผู้ใช้</SectionTitle>
            <ActionForm action={createUserAction} className="space-y-4" resetOnSuccess>
              <div>
                <label className="label" htmlFor="display_name">
                  ชื่อที่แสดง
                </label>
                <input
                  id="display_name"
                  name="display_name"
                  className="input"
                  placeholder="เช่น น้องพนักงาน"
                  required
                />
              </div>
              <div>
                <label className="label" htmlFor="email">
                  อีเมล (ใช้ล็อกอิน)
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  className="input"
                  autoComplete="off"
                  placeholder="staff@example.com"
                  required
                />
              </div>
              <div>
                <label className="label" htmlFor="password">
                  รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  className="input"
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>
              <div>
                <label className="label" htmlFor="role">
                  สิทธิ์
                </label>
                <select id="role" name="role" className="input" defaultValue="staff">
                  <option value="staff">พนักงาน — ลงยอดขาย ดูสต๊อกและลูกค้า</option>
                  <option value="admin">ผู้ดูแลระบบ — เห็นทุกอย่าง</option>
                </select>
              </div>
              <SubmitButton className="btn-primary w-full">เพิ่มผู้ใช้</SubmitButton>
            </ActionForm>
            <p className="mt-3 text-xs leading-relaxed text-mute">
              บัญชีถูกสร้างใน Supabase Auth และยืนยันอีเมลให้อัตโนมัติ ผู้ใช้ล็อกอินได้ทันที
              ไม่ต้องรอเมลยืนยัน
            </p>
          </div>

          <div className="card h-fit">
            <SectionTitle>ตั้งรหัสผ่านใหม่</SectionTitle>
            <ActionForm action={resetPasswordAction} className="space-y-4" resetOnSuccess>
              <div>
                <label className="label" htmlFor="reset_id">
                  เลือกผู้ใช้
                </label>
                <select id="reset_id" name="id" className="input" required defaultValue="">
                  <option value="" disabled>
                    — เลือกผู้ใช้ —
                  </option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.display_name} ({u.email})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="new_password">
                  รหัสผ่านใหม่
                </label>
                <input
                  id="new_password"
                  name="password"
                  type="password"
                  className="input"
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>
              <SubmitButton className="btn-ghost w-full">เปลี่ยนรหัสผ่าน</SubmitButton>
            </ActionForm>
          </div>
        </div>

        <div className="card">
          <SectionTitle right={<span className="text-xs text-mute">{num(users.length)} บัญชี</span>}>
            บัญชีทั้งหมด
          </SectionTitle>
          {users.length === 0 ? (
            <Empty>ยังไม่มีผู้ใช้</Empty>
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>ชื่อ</th>
                    <th>อีเมล</th>
                    <th>สิทธิ์</th>
                    <th className="text-right">บิลที่ลง</th>
                    <th>สร้างเมื่อ</th>
                    <th>สถานะ</th>
                    <th className="text-right">จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td className="font-medium text-white">
                        {u.display_name}
                        {u.id === me.id ? (
                          <span className="ml-2 text-xs text-brand-400">(คุณ)</span>
                        ) : null}
                      </td>
                      <td className="text-xs text-mute">{u.email ?? '-'}</td>
                      <td>
                        {u.id === me.id ? (
                          <Badge tone="brand">ผู้ดูแลระบบ</Badge>
                        ) : (
                          <form action={changeRoleAction} className="flex items-center gap-1.5">
                            <input type="hidden" name="id" value={u.id} />
                            <select
                              name="role"
                              defaultValue={u.role}
                              className="input w-auto py-1 text-xs"
                            >
                              <option value="staff">พนักงาน</option>
                              <option value="admin">ผู้ดูแลระบบ</option>
                            </select>
                            <button type="submit" className="btn-ghost btn-sm">
                              บันทึก
                            </button>
                          </form>
                        )}
                      </td>
                      <td className="text-right">{num(u.sales)}</td>
                      <td className="whitespace-nowrap text-xs text-mute">
                        {dateOnly(u.created_at)}
                      </td>
                      <td>
                        {u.is_active ? (
                          <Badge tone="good">ใช้งานได้</Badge>
                        ) : (
                          <Badge tone="bad">ปิดใช้งาน</Badge>
                        )}
                      </td>
                      <td>
                        <div className="flex justify-end gap-1.5">
                          {u.id === me.id ? (
                            <span className="text-xs text-mute">—</span>
                          ) : (
                            <>
                              <form action={toggleUserAction}>
                                <input type="hidden" name="id" value={u.id} />
                                <button type="submit" className="btn-ghost btn-sm">
                                  {u.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                                </button>
                              </form>
                              <form action={deleteUserAction}>
                                <input type="hidden" name="id" value={u.id} />
                                <ConfirmButton
                                  message={`ลบบัญชี "${u.display_name}" ออกจาก Supabase Auth ถาวร? บิลที่เคยลงไว้จะยังอยู่`}
                                >
                                  ลบ
                                </ConfirmButton>
                              </form>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-4 text-xs leading-relaxed text-mute">
            หมายเหตุ: ระบบจะไม่ยอมให้ปิดหรือลดสิทธิ์บัญชีผู้ดูแลคนสุดท้าย
            และคุณแก้ไขสิทธิ์ของตัวเองไม่ได้ เพื่อกันไม่ให้ล็อกตัวเองออกจากระบบ
          </p>
        </div>
      </div>

      {/* กำหนดเมนูที่พนักงานแต่ละคนเห็น */}
      <div className="mt-6 card">
        <SectionTitle
          right={<span className="text-xs text-mute">{num(staff.length)} คน</span>}
        >
          สิทธิ์การเข้าถึงเมนู (รายคน)
        </SectionTitle>

        <p className="mb-5 text-xs leading-relaxed text-mute">
          ติ๊กเฉพาะเมนูที่ต้องการให้พนักงานคนนั้นเห็น เมนูที่ไม่ได้ติ๊กจะหายไปจากแถบเมนู
          และถ้าพิมพ์ที่อยู่เว็บเข้าตรง ๆ ก็จะถูกกันออกเช่นกัน —
          ส่วน <b className="text-slate-200">ค่าใช้จ่ายรายเดือน</b> กับ{' '}
          <b className="text-slate-200">ผู้ใช้งานระบบ</b> เป็นของผู้ดูแลระบบเท่านั้น มอบให้พนักงานไม่ได้
        </p>

        {staff.length === 0 ? (
          <Empty>ยังไม่มีบัญชีพนักงาน — ผู้ดูแลระบบเห็นทุกเมนูอยู่แล้ว</Empty>
        ) : (
          <div className="space-y-4">
            {staff.map((u) => {
              const current =
                u.allowed_pages === null
                  ? (DEFAULT_STAFF_PAGES as string[])
                  : u.allowed_pages.split(',').filter(Boolean)

              return (
                <div key={u.id} className="rounded-xl border border-ink-700 bg-ink-850 p-4">
                  <ActionForm action={setPagesAction}>
                    <input type="hidden" name="id" value={u.id} />

                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-medium text-white">{u.display_name}</span>
                        <span className="ml-2 text-xs text-mute">{u.email}</span>
                      </div>
                      {u.allowed_pages === null ? (
                        <Badge>ใช้ค่าเริ่มต้น</Badge>
                      ) : (
                        <Badge tone="brand">กำหนดเอง {current.length} เมนู</Badge>
                      )}
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {ASSIGNABLE_PAGES.map((p) => (
                        <label
                          key={p.key}
                          className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2.5 transition hover:border-ink-600"
                        >
                          <input
                            type="checkbox"
                            name="pages"
                            value={p.key}
                            defaultChecked={current.includes(p.key)}
                            className="mt-0.5 size-4 rounded border-ink-600 bg-ink-850"
                          />
                          <span className="min-w-0">
                            <span className="block text-sm text-slate-100">
                              <span aria-hidden className="mr-1.5">
                                {p.icon}
                              </span>
                              {p.label}
                            </span>
                            <span className="block text-xs text-mute">{p.hint}</span>
                          </span>
                        </label>
                      ))}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <SubmitButton className="btn-primary btn-sm">บันทึกสิทธิ์</SubmitButton>
                      <button
                        type="submit"
                        name="reset"
                        value="1"
                        className="btn-ghost btn-sm"
                        formNoValidate
                      >
                        คืนค่าเริ่มต้น
                      </button>
                    </div>
                  </ActionForm>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
