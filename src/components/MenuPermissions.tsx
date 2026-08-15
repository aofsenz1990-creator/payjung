import 'server-only'
import { q } from '@/lib/db'
import { setPagesAction } from '@/lib/actions/users'
import { ASSIGNABLE_PAGES, DEFAULT_STAFF_PAGES } from '@/lib/pages'
import { num } from '@/lib/format'
import { ActionForm, SubmitButton } from '@/components/ActionForm'
import { Badge, Empty, SectionTitle } from '@/components/ui'

export type StaffRow = {
  id: string
  email: string | null
  display_name: string
  allowed_pages: string | null
}

/** ดึงรายชื่อพนักงานพร้อมสิทธิ์เมนูปัจจุบัน */
export async function loadStaff() {
  return q<StaffRow>(
    `select id, email, display_name,
            case when allowed_pages is null then null
                 else array_to_string(allowed_pages, ',') end as allowed_pages
       from profiles where role <> 'admin' order by display_name`
  )
}

/** การ์ดกำหนดว่าพนักงานแต่ละคนเห็นเมนูอะไรบ้าง — อยู่ในหน้าผู้ใช้งานระบบ */
export function MenuPermissions({ staff }: { staff: StaffRow[] }) {
  return (
    <div className="card">
      <SectionTitle right={<span className="text-xs text-mute">{num(staff.length)} คน</span>}>
        สิทธิ์การเข้าถึงเมนู (รายคน)
      </SectionTitle>

      <p className="mb-5 text-xs leading-relaxed text-mute">
        ติ๊กเฉพาะเมนูที่ต้องการให้พนักงานคนนั้นเห็น เมนูที่ไม่ได้ติ๊กจะหายไปจากแถบเมนู
        และถ้าพิมพ์ที่อยู่เว็บเข้าตรง ๆ ก็จะถูกกันออกเช่นกัน — ส่วน{' '}
        <b className="text-slate-200">ค่าใช้จ่ายรายเดือน</b> กับ{' '}
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
  )
}
