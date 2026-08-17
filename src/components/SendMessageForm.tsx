'use client'

import { ActionForm, SubmitButton } from '@/components/ActionForm'
import { sendCustomerMessageAction } from '@/lib/actions/messages'

/**
 * ฟอร์มส่งข้อความถึงลูกค้า ใช้ได้ทั้งหน้าลงยอดขายและหน้ารายชื่อลูกค้า
 *
 * ห่อด้วย <details> เพราะอยู่ในตารางที่แน่นอยู่แล้ว ปกติพับไว้ กดเมื่อจะใช้
 * (ใช้ของเบราว์เซอร์ตรง ๆ ไม่ต้องเขียน state เอง)
 */
export function SendMessageForm({
  customerId,
  saleId,
  saleCode,
  disabledReason,
  label = 'ส่งข้อความ',
}: {
  customerId: number
  saleId?: number
  saleCode?: string
  /** ถ้าลูกค้ายังไม่ได้เปิดบัญชีเว็บ ส่งไปก็ไม่มีใครเห็น บอกเหตุผลไว้เลย */
  disabledReason?: string
  label?: string
}) {
  if (disabledReason) {
    return <span className="text-xs text-mute">{disabledReason}</span>
  }

  return (
    <details className="w-full">
      <summary className="btn-ghost btn-sm cursor-pointer list-none text-center">{label}</summary>
      <div className="mt-2 rounded-xl border border-ink-700/70 bg-ink-950/60 p-3">
        <ActionForm action={sendCustomerMessageAction} resetOnSuccess>
          <input type="hidden" name="customer_id" value={customerId} />
          {saleId ? <input type="hidden" name="sale_id" value={saleId} /> : null}

          <label className="label" htmlFor={`kind-${customerId}-${saleId ?? 0}`}>
            ชนิดข้อความ
          </label>
          <select
            id={`kind-${customerId}-${saleId ?? 0}`}
            name="kind"
            className="input mb-2"
            defaultValue={saleId ? 'code' : 'message'}
          >
            <option value="code">โค้ดสินค้า — แสดงเป็นกล่องโค้ดพร้อมปุ่มคัดลอก</option>
            <option value="message">ข้อความทั่วไป</option>
          </select>

          <label className="label" htmlFor={`title-${customerId}-${saleId ?? 0}`}>
            หัวข้อ (ไม่ใส่ก็ได้)
          </label>
          <input
            id={`title-${customerId}-${saleId ?? 0}`}
            name="title"
            className="input mb-2"
            placeholder={saleCode ? `โค้ดของบิล ${saleCode}` : 'เช่น แจ้งโปรโมชั่น'}
            maxLength={100}
          />

          <label className="label" htmlFor={`body-${customerId}-${saleId ?? 0}`}>
            เนื้อหา
          </label>
          <textarea
            id={`body-${customerId}-${saleId ?? 0}`}
            name="body"
            className="input mb-2 min-h-20"
            placeholder="วางโค้ดบัตร หรือพิมพ์ข้อความถึงลูกค้า"
            maxLength={2000}
            required
          />

          <SubmitButton className="btn-primary btn-sm w-full" pendingLabel="กำลังส่ง...">
            ส่งให้ลูกค้า
          </SubmitButton>
        </ActionForm>
      </div>
    </details>
  )
}
