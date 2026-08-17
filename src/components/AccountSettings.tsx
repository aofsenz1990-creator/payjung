import { ActionForm, SubmitButton } from '@/components/ActionForm'
import { changeMyPasswordAction, updateMyProfileAction } from '@/lib/actions/account'

/**
 * กล่องแก้ข้อมูลส่วนตัวและเปลี่ยนรหัสผ่านของลูกค้า
 *
 * พับไว้ด้วย <details> เพราะคนส่วนใหญ่เข้าหน้านี้มาดูเครดิตกับประวัติการซื้อ
 * ไม่ได้มาแก้ข้อมูล กางค้างไว้จะไปดันของที่ใช้บ่อยกว่าให้ตกจอ
 */
export function AccountSettings({
  name,
  phone,
  gameUid,
}: {
  name: string
  phone: string | null
  gameUid: string | null
}) {
  return (
    <details className="rounded-2xl border border-ink-700/70 bg-ink-900/70 backdrop-blur-sm">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-fg">
        ⚙️ แก้ไขข้อมูลส่วนตัว / เปลี่ยนรหัสผ่าน
      </summary>

      <div className="grid gap-4 border-t border-ink-700/70 p-4 md:grid-cols-2">
        <div>
          <p className="mb-3 text-sm font-medium text-fg">ข้อมูลส่วนตัว</p>
          <ActionForm action={updateMyProfileAction} className="space-y-3">
            <div>
              <label className="label" htmlFor="acc-name">
                ชื่อที่ใช้แสดง
              </label>
              <input
                id="acc-name"
                name="name"
                className="input"
                defaultValue={name}
                maxLength={80}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="acc-phone">
                เบอร์โทร
              </label>
              <input
                id="acc-phone"
                name="phone"
                className="input"
                defaultValue={phone ?? ''}
                maxLength={30}
                placeholder="08x-xxx-xxxx"
              />
              <p className="mt-1 text-xs text-mute">ใช้ตอนร้านต้องติดต่อกลับเรื่องออเดอร์</p>
            </div>
            <div>
              <label className="label" htmlFor="acc-uid">
                ไอดีเกมที่ใช้ประจำ
              </label>
              <input
                id="acc-uid"
                name="game_uid"
                className="input"
                defaultValue={gameUid ?? ''}
                maxLength={120}
                placeholder="เช่น 123456789"
              />
              <p className="mt-1 text-xs text-mute">กรอกไว้แล้วเวลาสั่งซื้อจะเติมให้อัตโนมัติ</p>
            </div>
            <SubmitButton className="btn-primary w-full" pendingLabel="กำลังบันทึก...">
              บันทึกข้อมูล
            </SubmitButton>
          </ActionForm>
        </div>

        <div>
          <p className="mb-3 text-sm font-medium text-fg">เปลี่ยนรหัสผ่าน</p>
          <ActionForm action={changeMyPasswordAction} className="space-y-3" resetOnSuccess>
            <div>
              <label className="label" htmlFor="acc-current">
                รหัสผ่านเดิม
              </label>
              <input
                id="acc-current"
                name="current_password"
                type="password"
                className="input"
                autoComplete="current-password"
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="acc-new">
                รหัสผ่านใหม่
              </label>
              <input
                id="acc-new"
                name="password"
                type="password"
                className="input"
                autoComplete="new-password"
                minLength={8}
                required
              />
              <p className="mt-1 text-xs text-mute">อย่างน้อย 8 ตัวอักษร มีทั้งตัวอักษรและตัวเลข</p>
            </div>
            <div>
              <label className="label" htmlFor="acc-confirm">
                ยืนยันรหัสผ่านใหม่
              </label>
              <input
                id="acc-confirm"
                name="confirm"
                type="password"
                className="input"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            <SubmitButton className="btn-ghost w-full" pendingLabel="กำลังเปลี่ยน...">
              เปลี่ยนรหัสผ่าน
            </SubmitButton>
          </ActionForm>
        </div>
      </div>
    </details>
  )
}
