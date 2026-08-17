'use server'

import { revalidatePath } from 'next/cache'
import { q, q1 } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { removeSlip, SlipError, uploadSlip } from '@/lib/storage'
import { decimal, friendlyError, int, optStr, str } from '@/lib/form'
import type { ActionState } from '@/components/ActionForm'

/**
 * บันทึกครั้งที่ร้านเติมเงินเข้าบัญชีผู้ให้บริการ
 *
 * เก็บสลิปไว้ด้วย เพราะเวลายื่นภาษีต้องมีหลักฐานการจ่ายเงินจริง
 * ไม่ใช่แค่ตัวเลขที่พิมพ์เอง
 */
export async function saveProviderTopupAction(formData: FormData): Promise<ActionState> {
  const user = await requireAdmin()

  const id = str(formData, 'id')
  const providerId = int(formData, 'provider_id') || null
  const amount = decimal(formData, 'amount')
  const bonus = decimal(formData, 'bonus')
  const method = optStr(formData, 'method')
  const ref = optStr(formData, 'ref')
  const note = optStr(formData, 'note')
  const toppedUpAt = str(formData, 'topped_up_at')
  const slipData = str(formData, 'slip_data')

  if (!providerId) return { error: 'กรุณาเลือกผู้ให้บริการ' }
  if (amount <= 0) return { error: 'จำนวนเงินต้องมากกว่า 0' }
  if (bonus < 0) return { error: 'โบนัสต้องไม่ติดลบ' }
  if (!toppedUpAt) return { error: 'กรุณาเลือกวันที่' }

  let slipPath: string | null = null
  try {
    if (slipData) slipPath = await uploadSlip(slipData, new Date().toISOString())

    if (id) {
      // แนบสลิปใหม่ = ทับของเดิม ไม่แนบ = เก็บของเดิมไว้
      await q(
        `update provider_topups
            set provider_id = $1, amount = $2, bonus = $3, method = $4, ref = $5,
                note = $6, topped_up_at = $7::date,
                slip_path = coalesce($8, slip_path)
          where id = $9`,
        [providerId, amount, bonus, method, ref, note, toppedUpAt, slipPath, Number(id)]
      )
    } else {
      await q(
        `insert into provider_topups
           (provider_id, amount, bonus, method, ref, note, topped_up_at, slip_path, created_by)
         values ($1, $2, $3, $4, $5, $6, $7::date, $8, $9)`,
        [providerId, amount, bonus, method, ref, note, toppedUpAt, slipPath, user.id]
      )
    }
  } catch (err) {
    if (slipPath) await removeSlip(slipPath)
    if (err instanceof SlipError) return { error: err.message }
    return { error: friendlyError(err, 'บันทึกรายการเติมเงินไม่สำเร็จ') }
  }

  revalidatePath('/storefront')
  return {
    ok: `บันทึกการเติมเงิน ${amount.toLocaleString('th-TH')} บาทแล้ว`,
  }
}

export async function deleteProviderTopupAction(formData: FormData) {
  await requireAdmin()
  const id = int(formData, 'id')
  if (!id) return

  // ลบไฟล์สลิปตามไปด้วย ไม่งั้นจะเหลือไฟล์ค้างกินพื้นที่โดยไม่มีใครอ้างถึง
  const row = await q1<{ slip_path: string | null }>(
    'select slip_path from provider_topups where id = $1',
    [id]
  )
  await q('delete from provider_topups where id = $1', [id])
  if (row?.slip_path) await removeSlip(row.slip_path)

  revalidatePath('/storefront')
}
