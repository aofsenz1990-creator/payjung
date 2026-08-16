'use server'

import { revalidatePath } from 'next/cache'
import { q, q1 } from '@/lib/db'
import { requireAdmin, requireAnyPage, requirePage } from '@/lib/auth'
import { removeSlip, SlipError, uploadSlip } from '@/lib/storage'
import { decimal, friendlyError, int, optInt, optStr, str } from '@/lib/form'
import { localInputToISO } from '@/lib/format'
import type { ActionState } from '@/components/ActionForm'

function refreshSalesViews() {
  revalidatePath('/')
  revalidatePath('/sales')
  revalidatePath('/history')
  revalidatePath('/stock')
  revalidatePath('/customers')
}

/** ออกเลขบิลรูปแบบ PJ-YYMMDD-001 โดยนับจากบิลของวันนั้น (เวลาไทย) */
async function nextSaleCode(soldAtISO: string, attempt: number) {
  const row = await q1<{ code: string }>(
    `select 'PJ-' || to_char(($1::timestamptz at time zone 'Asia/Bangkok'), 'YYMMDD') || '-' ||
            lpad((count(*) + 1 + $2)::text, 3, '0') as code
       from sales
      where (sold_at at time zone 'Asia/Bangkok')::date
            = ($1::timestamptz at time zone 'Asia/Bangkok')::date`,
    [soldAtISO, attempt]
  )
  return row?.code ?? `PJ-${Date.now()}`
}

export async function createSaleAction(formData: FormData): Promise<ActionState> {
  const user = await requirePage('sales')

  const gameId = optInt(formData, 'game_id')
  const productId = optInt(formData, 'product_id')
  const customerName = optStr(formData, 'customer_name')
  const source = optStr(formData, 'source')
  const qty = Math.max(int(formData, 'qty', 1), 1)
  const unitPrice = decimal(formData, 'unit_price')
  const paymentMethod = str(formData, 'payment_method') || 'เงินสด'
  const status = ['paid', 'pending', 'cancelled'].includes(str(formData, 'status'))
    ? str(formData, 'status')
    : 'paid'
  const gameAccount = optStr(formData, 'game_account')
  const note = optStr(formData, 'note')
  const soldAt = localInputToISO(str(formData, 'sold_at')) ?? new Date().toISOString()

  let itemName = str(formData, 'item_name')
  let unitCost = 0
  let slipPath: string | null = null

  try {
    // ถ้าชื่อที่พิมพ์ตรงกับลูกค้าที่มีอยู่ ให้ผูกกับลูกค้าคนนั้น ยอดซื้อสะสมจะได้เดินต่อ
    // ถ้าไม่ตรง ก็เก็บชื่อไว้กับบิลเฉย ๆ ไม่ต้องสร้างลูกค้าใหม่ให้รกรายชื่อ
    let customerId: number | null = null
    if (customerName) {
      const found = await q1<{ id: number }>(
        'select id from customers where lower(name) = lower($1) limit 1',
        [customerName]
      )
      customerId = found?.id ?? null
    }

    if (productId) {
      const product = await q1<{
        id: number
        name: string
        game_id: number
        cost_price: number
        track_stock: boolean
        stock_qty: number
      }>(
        `select id, name, game_id, cost_price::float8 as cost_price, track_stock, stock_qty
           from products where id = $1`,
        [productId]
      )
      if (!product) return { error: 'ไม่พบแพ็กเกจที่เลือก' }
      if (!itemName) itemName = product.name
      unitCost = product.cost_price
      if (product.track_stock && status !== 'cancelled' && product.stock_qty < qty) {
        return {
          error: `สต๊อกไม่พอ — "${product.name}" เหลือ ${product.stock_qty} ชิ้น แต่ขาย ${qty} ชิ้น`,
        }
      }
    }

    // เฉพาะแอดมินเท่านั้นที่ระบุต้นทุนเองได้ พนักงานจะใช้ต้นทุนจากแพ็กเกจ
    if (user.role === 'admin' && str(formData, 'unit_cost') !== '') {
      unitCost = decimal(formData, 'unit_cost')
    }

    if (!itemName) return { error: 'กรุณาเลือกแพ็กเกจ หรือพิมพ์ชื่อรายการที่ขาย' }
    if (unitPrice <= 0) return { error: 'กรุณากรอกราคาขายต่อหน่วย' }

    const total = +(unitPrice * qty).toFixed(2)
    const costTotal = +(unitCost * qty).toFixed(2)
    const profit = +(total - costTotal).toFixed(2)

    // ทุกบิลต้องมีสลิปโอนเงินแนบมาด้วยเสมอ
    const slipData = str(formData, 'slip_data')
    if (!slipData) return { error: 'กรุณาแนบสลิปโอนเงินก่อนบันทึกการขาย' }
    slipPath = await uploadSlip(slipData, soldAt)

    let lastError: unknown = null
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = await nextSaleCode(soldAt, attempt)
      try {
        const rows = await q<{ id: number; code: string }>(
          `with s as (
             insert into sales (code, sold_at, customer_id, game_id, product_id, item_name,
                                game_account, qty, unit_price, unit_cost, total, cost_total,
                                profit, payment_method, status, note, created_by, slip_path,
                                customer_name, source)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
                     $18, $19, $20)
             returning id, code, product_id, qty, unit_cost, status
           ),
           upd as (
             update products set stock_qty = products.stock_qty - s.qty
               from s
              where products.id = s.product_id
                and products.track_stock
                and s.status <> 'cancelled'
             returning products.id
           ),
           mv as (
             insert into stock_movements (product_id, kind, qty, unit_cost, note, sale_id, created_by)
             select s.product_id, 'out', s.qty, s.unit_cost, 'ตัดสต๊อกอัตโนมัติจากการขาย', s.id, $17
               from s join products p on p.id = s.product_id
              where p.track_stock and s.status <> 'cancelled'
           )
           select id, code from s`,
          [
            code,
            soldAt,
            customerId,
            gameId,
            productId,
            itemName,
            gameAccount,
            qty,
            unitPrice,
            unitCost,
            total,
            costTotal,
            profit,
            paymentMethod,
            status,
            note,
            user.id,
            slipPath,
            customerName,
            source,
          ]
        )
        refreshSalesViews()
        return { ok: `บันทึกบิล ${rows[0].code} — ${itemName} × ${qty} = ${total.toLocaleString('th-TH')} บาท` }
      } catch (err) {
        lastError = err
        if (!/duplicate key|unique/i.test(String(err))) throw err
        // เลขบิลชนกัน (ลงยอดพร้อมกันสองเครื่อง) — วนไปเอาเลขถัดไป
      }
    }
    throw lastError
  } catch (err) {
    // บันทึกบิลไม่ผ่าน — เก็บกวาดสลิปที่อัปโหลดไปแล้ว ไม่ให้มีไฟล์ค้าง
    if (slipPath) await removeSlip(slipPath)
    if (err instanceof SlipError) return { error: err.message }
    return { error: friendlyError(err, 'ลงยอดขายไม่สำเร็จ') }
  }
}

/** ยกเลิกบิล แล้วคืนสต๊อกให้อัตโนมัติ */
export async function cancelSaleAction(formData: FormData) {
  // ยกเลิกบิลได้ทั้งจากหน้าลงยอดขายและหน้าประวัติ
  const user = await requireAnyPage('sales', 'history')
  const id = int(formData, 'id')
  await q(
    `with s as (
       update sales set status = 'cancelled'
        where id = $1 and status <> 'cancelled'
       returning id, product_id, qty, unit_cost
     ),
     upd as (
       update products set stock_qty = products.stock_qty + s.qty
         from s where products.id = s.product_id and products.track_stock
       returning products.id
     ),
     mv as (
       insert into stock_movements (product_id, kind, qty, unit_cost, note, sale_id, created_by)
       select s.product_id, 'in', s.qty, s.unit_cost, 'คืนสต๊อกจากการยกเลิกบิล', s.id, $2
         from s join products p on p.id = s.product_id
        where p.track_stock
     )
     select id from s`,
    [id, user.id]
  )
  refreshSalesViews()
}

/**
 * ยกเลิกบิลจากหน้าเว็บแล้วคืนเครดิตให้ลูกค้า — ใช้ตอนเติมเกมให้ไม่ได้
 * ยกเลิกบิล คืนเครดิต ลงสมุดเครดิต และคืนสต๊อก อยู่ในคำสั่งเดียวกันทั้งหมด
 * กันกดซ้ำด้วยการเช็กว่าเคยมีรายการคืนเครดิตของบิลนี้แล้วหรือยัง
 */
export async function refundSaleAction(formData: FormData): Promise<ActionState> {
  await requireAnyPage('sales', 'history')
  const id = int(formData, 'id')
  if (!id) return { error: 'ไม่พบบิลนี้' }

  try {
    const rows = await q<{ refunded: number; balance_after: number; code: string }>(
      `with s as (
         update sales set status = 'cancelled'
          where id = $1
            and status <> 'cancelled'
            and customer_id is not null
            and not exists (
              select 1 from credit_transactions t where t.sale_id = sales.id and t.kind = 'refund'
            )
         returning id, code, customer_id, product_id, qty, unit_cost, total
       ),
       cust as (
         update customers set credit = customers.credit + s.total
           from s where customers.id = s.customer_id
         returning customers.id, customers.credit
       ),
       tx as (
         insert into credit_transactions (customer_id, kind, amount, balance_after, note, sale_id)
         select cust.id, 'refund', s.total, cust.credit, $2, s.id from cust, s
       ),
       upd as (
         update products set stock_qty = products.stock_qty + s.qty
           from s where products.id = s.product_id and products.track_stock
         returning products.id
       ),
       mv as (
         insert into stock_movements (product_id, kind, qty, unit_cost, note, sale_id)
         select s.product_id, 'in', s.qty, s.unit_cost, 'คืนสต๊อกจากการคืนเครดิต', s.id
           from s join products p on p.id = s.product_id where p.track_stock
       )
       select s.code, s.total::float8 as refunded, cust.credit::float8 as balance_after
         from s, cust`,
      [id, optStr(formData, 'note') ?? 'คืนเครดิตเพราะเติมเกมไม่สำเร็จ']
    )

    if (rows.length === 0) {
      return { error: 'คืนเครดิตไม่ได้ — บิลนี้อาจคืนไปแล้ว ถูกยกเลิกแล้ว หรือไม่ใช่บิลที่ตัดจากเครดิต' }
    }

    refreshSalesViews()
    revalidatePath('/customers')
    return {
      ok:
        `คืนเครดิต ${rows[0].refunded.toLocaleString('th-TH')} บาท ของบิล ${rows[0].code} แล้ว — ` +
        `เครดิตลูกค้าคงเหลือ ${rows[0].balance_after.toLocaleString('th-TH')} บาท`,
    }
  } catch (err) {
    return { error: friendlyError(err, 'คืนเครดิตไม่สำเร็จ') }
  }
}

export async function markPaidAction(formData: FormData) {
  await requireAnyPage('sales', 'history')
  // ปิดคิวส่งอัตโนมัติไปพร้อมกัน — พนักงานกดปุ่มนี้แปลว่าเติมเข้าเกมเองเรียบร้อยแล้ว
  // ถ้าไม่ปิด ระบบจะส่งออเดอร์ต่อให้ผู้ให้บริการอีกรอบ = เติมซ้ำสองครั้ง
  await q(
    `update sales
        set status = 'paid',
            provider_state = case when provider_state in ('queued', 'error')
                                  then 'manual' else provider_state end
      where id = $1 and status = 'pending'`,
    [int(formData, 'id')]
  )
  refreshSalesViews()
}

/** ลบบิลถาวร (เฉพาะแอดมิน) — คืนสต๊อกก่อนถ้าบิลยังไม่ถูกยกเลิก */
export async function deleteSaleAction(formData: FormData) {
  await requireAdmin()
  const id = int(formData, 'id')
  await q(
    `with s as (
       update sales set status = 'cancelled' where id = $1 and status <> 'cancelled'
       returning id, product_id, qty
     ),
     upd as (
       update products set stock_qty = products.stock_qty + s.qty
         from s where products.id = s.product_id and products.track_stock
       returning products.id
     )
     select id from s`,
    [id]
  )
  const doomed = await q1<{ slip_path: string | null }>(
    'select slip_path from sales where id = $1',
    [id]
  )
  await q('delete from sales where id = $1', [id])
  if (doomed?.slip_path) await removeSlip(doomed.slip_path)
  refreshSalesViews()
}
