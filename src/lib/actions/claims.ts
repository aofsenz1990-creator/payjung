'use server'

import { revalidatePath } from 'next/cache'
import { q } from '@/lib/db'
import { requirePage, requireAdmin } from '@/lib/auth'
import { removeSlip, SlipError, uploadSlip } from '@/lib/storage'
import { decimal, friendlyError, int, optInt, optStr, str } from '@/lib/form'
import { CLAIM_CHANNELS } from '@/lib/constants'
import type { ActionState } from '@/components/ActionForm'

/** บันทึกรายการเคลม — เติมเกมให้ไม่สำเร็จ ต้องโอนเงินคืนลูกค้า */
export async function saveClaimAction(formData: FormData): Promise<ActionState> {
  const user = await requirePage('claims')

  const customerId = optInt(formData, 'customer_id')
  const customerName = str(formData, 'customer_name')
  const channel = (CLAIM_CHANNELS as readonly string[]).includes(str(formData, 'contact_channel'))
    ? str(formData, 'contact_channel')
    : null
  const contactValue = optStr(formData, 'contact_value')
  const amount = decimal(formData, 'amount')
  const gameId = optInt(formData, 'game_id')
  const gameName = optStr(formData, 'game_name')
  const note = optStr(formData, 'note')
  const markPaid = str(formData, 'status') === 'paid'

  if (!customerName) return { error: 'กรุณากรอกชื่อลูกค้า' }
  if (amount <= 0) return { error: 'จำนวนเงินต้องมากกว่า 0' }
  if (!gameId && !gameName) return { error: 'กรุณาระบุเกมที่เติมไม่สำเร็จ' }

  let slipPath: string | null = null
  try {
    const slipData = str(formData, 'slip_data')
    if (slipData) slipPath = await uploadSlip(slipData, new Date().toISOString())

    await q(
      `insert into claims (customer_id, customer_name, contact_channel, contact_value, amount,
                           game_id, game_name, slip_path, note, status, created_by, paid_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
               case when $10 = 'paid' then now() else null end)`,
      [
        customerId,
        customerName,
        channel,
        contactValue,
        amount,
        gameId,
        gameName,
        slipPath,
        note,
        markPaid ? 'paid' : 'pending',
        user.id,
      ]
    )
  } catch (err) {
    if (slipPath) await removeSlip(slipPath)
    if (err instanceof SlipError) return { error: err.message }
    return { error: friendlyError(err, 'บันทึกรายการเคลมไม่สำเร็จ') }
  }

  revalidatePath('/claims')
  return {
    ok:
      `บันทึกเคลมของ "${customerName}" จำนวน ${amount.toLocaleString('th-TH')} บาทแล้ว` +
      (markPaid ? ' (โอนคืนแล้ว)' : ' — อย่าลืมโอนคืนลูกค้า'),
  }
}

/** ทำเครื่องหมายว่าโอนคืนแล้ว พร้อมแนบสลิปการโอนได้ */
export async function markClaimPaidAction(formData: FormData): Promise<ActionState> {
  await requirePage('claims')
  const id = int(formData, 'id')
  if (!id) return { error: 'ไม่พบรายการนี้' }

  let slipPath: string | null = null
  try {
    const slipData = str(formData, 'slip_data')
    if (slipData) slipPath = await uploadSlip(slipData, new Date().toISOString())

    await q(
      `update claims
          set status = 'paid', paid_at = now(),
              slip_path = coalesce($2, slip_path)
        where id = $1`,
      [id, slipPath]
    )
  } catch (err) {
    if (slipPath) await removeSlip(slipPath)
    if (err instanceof SlipError) return { error: err.message }
    return { error: friendlyError(err) }
  }

  revalidatePath('/claims')
  return { ok: 'บันทึกว่าโอนคืนแล้ว' }
}

export async function deleteClaimAction(formData: FormData) {
  await requireAdmin()
  const id = int(formData, 'id')
  const rows = await q<{ slip_path: string | null }>(
    'delete from claims where id = $1 returning slip_path',
    [id]
  )
  if (rows[0]?.slip_path) await removeSlip(rows[0].slip_path)
  revalidatePath('/claims')
}
