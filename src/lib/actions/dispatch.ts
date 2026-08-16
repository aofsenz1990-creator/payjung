'use server'

import { revalidatePath } from 'next/cache'
import { q, q1 } from '@/lib/db'
import { requireAdmin, requireAnyPage } from '@/lib/auth'
import {
  AUTO_DISPATCH_KEY,
  autoDispatchOn,
  dispatchSale,
  MAX_ATTEMPTS,
  providerBalance,
} from '@/lib/dispatch'
import { ProviderError } from '@/lib/providers/types'
import { supportsAuto } from '@/lib/providers/registry'
import { friendlyError, int, str } from '@/lib/form'
import type { ActionState } from '@/components/ActionForm'

function refreshOrderViews() {
  revalidatePath('/sales')
  revalidatePath('/history')
  revalidatePath('/customers')
  revalidatePath('/')
}

/**
 * กดส่งออเดอร์ไปผู้ให้บริการเอง — ใช้ตอนปิดสวิตช์อัตโนมัติไว้ หรือตอนส่งรอบก่อนไม่ผ่าน
 *
 * ไม่รีเซ็ตจำนวนครั้งที่เคยลองกลับเป็นศูนย์โดยเด็ดขาด เพราะเครื่องยนต์ใช้ค่านี้
 * ตัดสินใจว่าต้อง "ถามปลายทางก่อนส่งซ้ำ" ไหม ถ้ารีเซ็ตจะกลายเป็นยิงใหม่ทันที = เสี่ยงเติมสองรอบ
 */
export async function sendToProviderAction(formData: FormData): Promise<ActionState> {
  await requireAnyPage('sales', 'history')
  const id = int(formData, 'id')
  if (!id) return { error: 'ไม่พบบิลนี้' }

  try {
    const rows = await q<{ id: number }>(
      `update sales
          set provider_state = 'queued',
              provider_attempts = least(provider_attempts, $2)
        where id = $1
          and status <> 'cancelled'
          and provider_state in ('queued', 'manual', 'error')
       returning id`,
      [id, MAX_ATTEMPTS - 1]
    )
    if (rows.length === 0) {
      return { error: 'ส่งไม่ได้ — บิลนี้ถูกยกเลิก ส่งไปแล้ว หรือกำลังส่งอยู่' }
    }

    const outcome = await dispatchSale(id)
    refreshOrderViews()

    if (!outcome) return { ok: 'ระบบกำลังส่งออเดอร์นี้อยู่ รอสักครู่แล้วรีเฟรชหน้า' }
    if (outcome.state === 'success') return { ok: `เติมสำเร็จ — ${outcome.message}` }
    if (outcome.state === 'sent') return { ok: `ส่งให้ผู้ให้บริการแล้ว — ${outcome.message}` }
    if (outcome.state === 'failed') {
      return { ok: `ปลายทางแจ้งว่าเติมไม่สำเร็จ คืนเครดิตให้ลูกค้าแล้ว — ${outcome.message}` }
    }
    return { error: outcome.message }
  } catch (err) {
    if (err instanceof ProviderError) return { error: err.message }
    return { error: friendlyError(err, 'ส่งออเดอร์ไม่สำเร็จ') }
  }
}

/**
 * บอกระบบว่าบิลนี้จะเติมเอง ไม่ต้องส่งอัตโนมัติ
 * สำคัญมาก: ถ้าพนักงานเติมเข้าเกมเองแล้วไม่กดปุ่มนี้ ระบบจะยังส่งออเดอร์ต่อให้ = เติมซ้ำสองรอบ
 */
export async function stopDispatchAction(formData: FormData): Promise<ActionState> {
  await requireAnyPage('sales', 'history')
  const id = int(formData, 'id')
  if (!id) return { error: 'ไม่พบบิลนี้' }

  const rows = await q<{ id: number }>(
    `update sales
        set provider_state = 'manual',
            provider_message = 'พนักงานเลือกเติมเอง'
      where id = $1 and provider_state in ('queued', 'error')
     returning id`,
    [id]
  )
  if (rows.length === 0) {
    return { error: 'หยุดไม่ได้ — บิลนี้ส่งไปให้ผู้ให้บริการแล้ว' }
  }
  refreshOrderViews()
  return { ok: 'หยุดการส่งอัตโนมัติของบิลนี้แล้ว — เติมเองได้เลย' }
}

/** เปิด/ปิดการส่งออเดอร์อัตโนมัติทั้งระบบ */
export async function toggleAutoDispatchAction(): Promise<ActionState> {
  await requireAdmin()
  const on = await autoDispatchOn()
  await q(
    `insert into site_settings (key, value) values ($1, $2)
     on conflict (key) do update set value = excluded.value`,
    [AUTO_DISPATCH_KEY, on ? 'off' : 'on']
  )
  revalidatePath('/storefront')
  revalidatePath('/sales')
  return {
    ok: on
      ? 'ปิดการส่งอัตโนมัติแล้ว — ออเดอร์ใหม่จะรอให้กดส่งเองที่หน้าลงยอดขาย'
      : 'เปิดการส่งอัตโนมัติแล้ว — ออเดอร์ใหม่จะถูกส่งให้ผู้ให้บริการทันที',
  }
}

/** เช็กยอดคงเหลือของร้านเราที่ผู้ให้บริการใหม่ทันที */
export async function refreshBalanceAction(formData: FormData): Promise<ActionState> {
  await requireAdmin()
  const id = int(formData, 'provider_id') || int(formData, 'id')
  if (!id) return { error: 'กรุณาเลือกผู้ให้บริการ' }

  const row = await q1<{
    id: number
    name: string
    kind: string
    base_url: string | null
    username: string | null
    api_key: string | null
    balance: number | null
    balance_at: string | null
  }>(
    `select id, name, kind, base_url, username, api_key,
            balance::float8 as balance, balance_at
       from api_providers where id = $1`,
    [id]
  )
  if (!row) return { error: 'ไม่พบผู้ให้บริการนี้' }
  if (!supportsAuto(row.kind)) {
    return { error: `"${row.name}" ยังไม่รองรับการเช็กยอดอัตโนมัติ` }
  }

  try {
    const wallet = await providerBalance(row, { force: true })
    revalidatePath('/storefront')
    revalidatePath('/')
    return {
      ok:
        `${row.name} เหลือ ${wallet.balance.toLocaleString('th-TH')} ${wallet.unit}` +
        (wallet.account ? ` (บัญชี ${wallet.account})` : ''),
    }
  } catch (err) {
    if (err instanceof ProviderError) return { error: err.message }
    return { error: friendlyError(err, 'เช็กยอดไม่สำเร็จ') }
  }
}

/** ตั้งยอดขั้นต่ำที่จะให้ขึ้นเตือนว่าพอยต์ใกล้หมด */
export async function setLowBalanceAction(formData: FormData): Promise<ActionState> {
  await requireAdmin()
  const id = int(formData, 'provider_id')
  const value = Number.parseFloat(str(formData, 'low_balance').replace(/,/g, ''))
  if (!id) return { error: 'กรุณาเลือกผู้ให้บริการ' }

  await q('update api_providers set low_balance = $2 where id = $1', [
    id,
    Number.isFinite(value) && value > 0 ? value : 0,
  ])
  revalidatePath('/storefront')
  revalidatePath('/')
  return { ok: 'บันทึกยอดแจ้งเตือนแล้ว' }
}
