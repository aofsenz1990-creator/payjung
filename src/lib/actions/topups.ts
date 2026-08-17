'use server'

import { revalidatePath } from 'next/cache'
import { q } from '@/lib/db'
import { requirePage } from '@/lib/auth'
import { getShopCustomer } from '@/lib/shop'
import { removeSlip, SlipError, uploadSlip } from '@/lib/storage'
import { customerError, decimal, friendlyError, int, optStr, str } from '@/lib/form'
import { tooMany, tooManyFromIp, TOO_MANY_MESSAGE } from '@/lib/ratelimit'
import type { ActionState } from '@/components/ActionForm'

/** ลูกค้าแจ้งโอนเงินเพื่อขอเติมเครดิต — ต้องแนบสลิปเสมอ */
export async function requestTopupAction(formData: FormData): Promise<ActionState> {
  const customer = await getShopCustomer()
  if (!customer) return { error: 'กรุณาเข้าสู่ระบบก่อน' }

  const amount = decimal(formData, 'amount')
  const note = optStr(formData, 'note')
  const slipData = str(formData, 'slip_data')

  if (amount <= 0) return { error: 'กรุณากรอกจำนวนเงินที่โอน' }
  if (amount > 200000) return { error: 'จำนวนเงินสูงผิดปกติ กรุณาติดต่อร้านโดยตรง' }
  if (!slipData) return { error: 'กรุณาแนบสลิปการโอนเงิน' }

  // แต่ละครั้งอัปโหลดรูปขึ้น Storage ด้วย ถ้าไม่กันจะโดนยิงจนพื้นที่เก็บเต็ม
  if (await tooMany(`topup:customer:${customer.id}`, 10, 3600)) {
    return { error: TOO_MANY_MESSAGE }
  }
  if (await tooManyFromIp('topup', 20, 3600)) return { error: TOO_MANY_MESSAGE }

  let slipPath: string | null = null
  try {
    // กันแจ้งซ้ำรัว ๆ ถ้ายังมีรายการรออนุมัติเกิน 5 รายการ
    const pending = await q<{ n: number }>(
      `select count(*)::int as n from credit_requests
        where customer_id = $1 and status = 'pending'`,
      [customer.id]
    )
    if ((pending[0]?.n ?? 0) >= 5) {
      return { error: 'มีรายการรออนุมัติอยู่หลายรายการแล้ว กรุณารอร้านตรวจสอบก่อน' }
    }

    slipPath = await uploadSlip(slipData, new Date().toISOString())
    await q(
      `insert into credit_requests (customer_id, amount, slip_path, note)
       values ($1, $2, $3, $4)`,
      [customer.id, amount, slipPath, note]
    )
  } catch (err) {
    if (slipPath) await removeSlip(slipPath)
    if (err instanceof SlipError) return { error: err.message }
    return { error: customerError(err, 'แจ้งเติมเครดิตไม่สำเร็จ') }
  }

  revalidatePath('/shop/topup')
  revalidatePath('/topups')
  return {
    ok: `แจ้งเติมเครดิต ${amount.toLocaleString('th-TH')} บาทแล้ว รอทางร้านตรวจสอบสลิปและอนุมัติ`,
  }
}

/**
 * ร้านกดอนุมัติ — เติมเครดิตให้ลูกค้าและลงสมุดบัญชีเครดิตในคำสั่งเดียว
 * กันกดซ้ำด้วยเงื่อนไข status = 'pending' ในคำสั่ง update
 */
export async function approveTopupAction(formData: FormData): Promise<ActionState> {
  const user = await requirePage('topups')
  const id = int(formData, 'id')
  if (!id) return { error: 'ไม่พบรายการนี้' }

  try {
    const rows = await q<{ name: string; amount: number; balance_after: number }>(
      `with r as (
         update credit_requests
            set status = 'approved', reviewed_by = $2, reviewed_at = now()
          where id = $1 and status = 'pending'
         returning id, customer_id, amount
       ),
       cust as (
         update customers set credit = customers.credit + r.amount
           from r where customers.id = r.customer_id
         returning customers.id, customers.name, customers.credit
       ),
       tx as (
         insert into credit_transactions (customer_id, kind, amount, balance_after, note)
         select cust.id, 'topup', r.amount, cust.credit,
                'ลูกค้าแจ้งโอนเงินผ่านหน้าเว็บ (อนุมัติแล้ว)'
           from cust, r
       )
       select cust.name, r.amount::float8 as amount, cust.credit::float8 as balance_after
         from r, cust`,
      [id, user.id]
    )

    if (rows.length === 0) return { error: 'อนุมัติไม่ได้ — รายการนี้อาจถูกดำเนินการไปแล้ว' }

    revalidatePath('/topups')
    revalidatePath('/customers')
    return {
      ok:
        `อนุมัติเติมเครดิต ${rows[0].amount.toLocaleString('th-TH')} บาท ให้ ${rows[0].name} แล้ว — ` +
        `เครดิตคงเหลือ ${rows[0].balance_after.toLocaleString('th-TH')} บาท`,
    }
  } catch (err) {
    return { error: friendlyError(err, 'อนุมัติไม่สำเร็จ') }
  }
}

export async function rejectTopupAction(formData: FormData): Promise<ActionState> {
  const user = await requirePage('topups')
  const id = int(formData, 'id')
  const reason = optStr(formData, 'reject_reason')
  if (!id) return { error: 'ไม่พบรายการนี้' }

  try {
    const rows = await q<{ id: number }>(
      `update credit_requests
          set status = 'rejected', reject_reason = $3, reviewed_by = $2, reviewed_at = now()
        where id = $1 and status = 'pending'
       returning id`,
      [id, user.id, reason]
    )
    if (rows.length === 0) return { error: 'ปฏิเสธไม่ได้ — รายการนี้อาจถูกดำเนินการไปแล้ว' }
  } catch (err) {
    return { error: friendlyError(err) }
  }

  revalidatePath('/topups')
  return { ok: 'ปฏิเสธรายการแล้ว ลูกค้าจะเห็นสถานะที่หน้าเว็บ' }
}
