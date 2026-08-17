import { ActionForm, SubmitButton } from '@/components/ActionForm'
import {
  saveLineSettingsAction,
  saveLineTargetAction,
  startLinePairingAction,
  testLineNotifyAction,
  unlinkLineAction,
} from '@/lib/actions/line'

/**
 * แผงตั้งค่าแจ้งเตือนเข้า LINE
 *
 * ขั้นตอนของ LINE ยุ่งพอสมควร (ต้องไปสร้าง OA + Messaging API เอง)
 * จึงเขียนขั้นตอนไว้ในหน้านี้เลย จะได้ไม่ต้องสลับไปเปิดคู่มือ
 */
export function LineNotifyPanel({
  hasToken,
  hasSecret,
  linked,
  webhookUrl,
}: {
  hasToken: boolean
  hasSecret: boolean
  linked: boolean
  webhookUrl: string
}) {
  return (
    <div className="space-y-4">
      <div
        className={`rounded-xl border px-4 py-3 text-sm ${
          linked
            ? 'border-good/40 bg-good/10 text-good'
            : 'border-warn/40 bg-warn/10 text-warn'
        }`}
      >
        {linked
          ? '✓ ผูกกับ LINE แล้ว — มีลูกค้าแจ้งโอนเงินเมื่อไหร่ จะเด้งเข้า LINE ทันที'
          : '⏳ ยังไม่ได้ผูก — ทำตาม 4 ขั้นตอนด้านล่างให้ครบก่อน'}
      </div>

      {/* ขั้นที่ 1-2 : ไปเอาคีย์จาก LINE Developers */}
      <div className="rounded-xl border border-ink-700 bg-ink-850 p-3">
        <p className="mb-2 text-sm font-medium text-slate-100">
          ขั้นที่ 1 · สร้างช่องทาง Messaging API
        </p>
        <ol className="mb-3 list-decimal space-y-1 pl-5 text-xs leading-relaxed text-mute">
          <li>
            เข้า{' '}
            <a
              href="https://developers.line.biz/console/"
              target="_blank"
              rel="noreferrer"
              className="text-brand-400 underline"
            >
              developers.line.biz/console
            </a>{' '}
            แล้วล็อกอินด้วยบัญชี LINE ของร้าน
          </li>
          <li>สร้าง Provider (ใส่ชื่อร้านก็ได้) → สร้าง Channel แบบ Messaging API</li>
          <li>
            แท็บ <b className="text-slate-200">Basic settings</b> → คัดลอก{' '}
            <b className="text-slate-200">Channel secret</b>
          </li>
          <li>
            แท็บ <b className="text-slate-200">Messaging API</b> → เลื่อนล่างสุด กด Issue แล้วคัดลอก{' '}
            <b className="text-slate-200">Channel access token (long-lived)</b>
          </li>
        </ol>

        <p className="mb-2 text-sm font-medium text-slate-100">ขั้นที่ 2 · วางคีย์ตรงนี้</p>
        <ActionForm action={saveLineSettingsAction} className="space-y-2">
          <div>
            <label className="label" htmlFor="line_channel_token">
              Channel access token {hasToken ? '(บันทึกไว้แล้ว)' : ''}
            </label>
            <input
              id="line_channel_token"
              name="line_channel_token"
              type="password"
              className="input"
              autoComplete="off"
              placeholder={hasToken ? 'เว้นว่าง = ใช้ค่าเดิม' : 'วางค่าที่คัดลอกมา'}
            />
          </div>
          <div>
            <label className="label" htmlFor="line_channel_secret">
              Channel secret {hasSecret ? '(บันทึกไว้แล้ว)' : ''}
            </label>
            <input
              id="line_channel_secret"
              name="line_channel_secret"
              type="password"
              className="input"
              autoComplete="off"
              placeholder={hasSecret ? 'เว้นว่าง = ใช้ค่าเดิม' : 'วางค่าที่คัดลอกมา'}
            />
          </div>
          <SubmitButton className="btn-primary w-full" pendingLabel="กำลังบันทึก...">
            บันทึกคีย์
          </SubmitButton>
        </ActionForm>
      </div>

      {/* ขั้นที่ 3 : ปลายทาง — ทางลัดที่ไม่ต้องตั้ง webhook เลย */}
      <div className="rounded-xl border border-brand-500/40 bg-brand-500/10 p-3">
        <p className="mb-2 text-sm font-medium text-slate-100">
          ขั้นที่ 3 · จะให้แจ้งเตือนไปหาใคร (วิธีเร็ว)
        </p>
        <p className="mb-2 text-xs leading-relaxed text-mute">
          ที่{' '}
          <a
            href="https://developers.line.biz/console/"
            target="_blank"
            rel="noreferrer"
            className="text-brand-400 underline"
          >
            developers.line.biz
          </a>{' '}
          → เข้า Channel ของร้าน → แท็บ <b className="text-slate-200">Basic settings</b> →
          เลื่อนล่างสุด จะเจอบรรทัด <b className="text-slate-200">Your user ID</b> ขึ้นต้นด้วย U →
          กดคัดลอกมาวางตรงนี้
        </p>
        <ActionForm action={saveLineTargetAction} className="flex flex-wrap gap-2">
          <input
            name="line_target_id"
            className="input min-w-0 flex-1 font-mono text-xs"
            placeholder="Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            autoComplete="off"
          />
          <SubmitButton className="btn-primary" pendingLabel="กำลังบันทึก...">
            บันทึกปลายทาง
          </SubmitButton>
        </ActionForm>
        <p className="mt-2 text-xs leading-relaxed text-mute">
          ⚠️ ต้องแอดเพื่อนกับ OA ของร้านไว้ก่อน ไม่งั้น LINE จะไม่ยอมส่งข้อความให้ ·
          ใช้วิธีนี้แล้ว<b className="text-slate-200">ข้ามขั้นที่ 4 และ 5 ไปได้เลย</b>
        </p>
      </div>

      {/* ขั้นที่ 4 : เอา URL ไปใส่ใน LINE (จำเป็นเฉพาะตอนอยากส่งเข้ากลุ่ม) */}
      <div className="rounded-xl border border-ink-700 bg-ink-850 p-3">
        <p className="mb-2 text-sm font-medium text-slate-100">
          ขั้นที่ 4 · ใส่ Webhook URL (ข้ามได้ถ้าทำขั้นที่ 3 แล้ว)
        </p>
        <p className="mb-2 text-xs leading-relaxed text-mute">
          ทำเฉพาะตอนอยากให้แจ้งเตือน<b className="text-slate-200">เข้ากลุ่ม LINE ของทีมงาน</b>{' '}
          เพราะกลุ่มไม่มีที่ให้ดูรหัสปลายทาง ต้องผูกด้วยรหัส 6 หลักในขั้นที่ 5 แทน
        </p>
        <p className="mb-2 text-xs leading-relaxed text-mute">
          กลับไปที่แท็บ <b className="text-slate-200">Messaging API</b> → หัวข้อ Webhook settings →
          วาง URL นี้ → กด Update แล้วเปิดสวิตช์{' '}
          <b className="text-slate-200">Use webhook</b> ให้เป็นสีเขียว
        </p>
        <code className="block overflow-x-auto rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 font-mono text-xs text-brand-400 select-all">
          {webhookUrl}
        </code>
        <p className="mt-2 text-xs leading-relaxed text-mute">
          ในหน้าเดียวกัน เลื่อนหา <b className="text-slate-200">Auto-reply messages</b> แล้วปิดไว้
          ไม่งั้น LINE จะตอบข้อความอัตโนมัติทับทุกครั้งที่มีคนทัก
        </p>
      </div>

      {/* ขั้นที่ 4 : ผูกปลายทาง */}
      <div className="rounded-xl border border-ink-700 bg-ink-850 p-3">
        <p className="mb-2 text-sm font-medium text-slate-100">
          ขั้นที่ 5 · ผูกด้วยรหัส 6 หลัก (ข้ามได้ถ้าทำขั้นที่ 3 แล้ว)
        </p>
        <p className="mb-3 text-xs leading-relaxed text-mute">
          กดปุ่มด้านล่างเพื่อรับรหัส 6 หลัก แล้วเปิดแอป LINE
          <b className="text-slate-200"> พิมพ์รหัสนั้นทักไปหาบัญชีทางการของร้าน</b> ระบบจะจดไว้เอง ·
          ถ้าอยากให้ทั้งทีมเห็น ให้เชิญ OA เข้ากลุ่มก่อนแล้วพิมพ์รหัสในกลุ่มนั้นแทน
        </p>
        <div className="flex flex-wrap gap-2">
          <ActionForm action={startLinePairingAction}>
            <SubmitButton className="btn-primary" pendingLabel="กำลังสร้าง...">
              สร้างรหัสผูก
            </SubmitButton>
          </ActionForm>
          <ActionForm action={testLineNotifyAction}>
            <SubmitButton className="btn-ghost" pendingLabel="กำลังส่ง...">
              ส่งข้อความทดสอบ
            </SubmitButton>
          </ActionForm>
          {linked ? (
            <ActionForm action={unlinkLineAction}>
              <SubmitButton className="btn-ghost text-warn" pendingLabel="...">
                ยกเลิกการผูก
              </SubmitButton>
            </ActionForm>
          ) : null}
        </div>
      </div>
    </div>
  )
}
