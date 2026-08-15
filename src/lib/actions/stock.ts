'use server'

import { revalidatePath } from 'next/cache'
import { q, q1 } from '@/lib/db'
import { requirePage } from '@/lib/auth'
import { decimal, friendlyError, int, optStr, str } from '@/lib/form'
import type { ActionState } from '@/components/ActionForm'

/**
 * ปรับสต๊อก 3 แบบ
 *  - in     : รับของเข้า (บวกจำนวน) พร้อมบันทึกทุนต่อหน่วยของล็อตนั้น
 *  - out    : ตัดออกเอง เช่น ของหาย / ใช้เอง
 *  - adjust : นับสต๊อกจริงแล้วตั้งค่าใหม่ให้ตรง
 */
export async function stockMoveAction(formData: FormData): Promise<ActionState> {
  const user = await requirePage('stock')
  const productId = int(formData, 'product_id')
  const kind = str(formData, 'kind')
  const qty = int(formData, 'qty')
  const note = optStr(formData, 'note')
  const unitCost = decimal(formData, 'unit_cost')

  if (!productId) return { error: 'กรุณาเลือกแพ็กเกจ' }
  if (!['in', 'out', 'adjust'].includes(kind)) return { error: 'ประเภทการเคลื่อนไหวไม่ถูกต้อง' }
  if (kind !== 'adjust' && qty <= 0) return { error: 'จำนวนต้องมากกว่า 0' }
  if (kind === 'adjust' && qty < 0) return { error: 'จำนวนคงเหลือต้องไม่ติดลบ' }

  try {
    const product = await q1<{ name: string; stock_qty: number; track_stock: boolean }>(
      'select name, stock_qty, track_stock from products where id = $1',
      [productId]
    )
    if (!product) return { error: 'ไม่พบแพ็กเกจนี้' }
    if (!product.track_stock) {
      return { error: `"${product.name}" ตั้งค่าเป็นแบบไม่นับสต๊อก — แก้ที่หน้าเกมก่อน` }
    }
    if (kind === 'out' && product.stock_qty < qty) {
      return { error: `ตัดออกไม่ได้ เพราะเหลือแค่ ${product.stock_qty} ชิ้น` }
    }

    const delta = kind === 'in' ? qty : kind === 'out' ? -qty : qty - product.stock_qty
    const newQty = kind === 'adjust' ? qty : product.stock_qty + delta

    await q(
      `with upd as (
         update products set stock_qty = $2 where id = $1 returning id
       )
       insert into stock_movements (product_id, kind, qty, unit_cost, note, created_by)
       values ($1, $3, $4, $5, $6, $7)`,
      [
        productId,
        newQty,
        kind,
        kind === 'adjust' ? delta : qty,
        kind === 'in' ? unitCost : 0,
        note,
        user.id,
      ]
    )

    // รับของเข้าพร้อมทุนใหม่ ให้ปรับทุนตั้งต้นของแพ็กเกจตามล็อตล่าสุด
    if (kind === 'in' && unitCost > 0) {
      await q('update products set cost_price = $2 where id = $1', [productId, unitCost])
    }

    revalidatePath('/stock')
    revalidatePath('/games')
    revalidatePath('/')
    return { ok: `อัปเดตสต๊อก "${product.name}" เป็น ${newQty} ชิ้นแล้ว` }
  } catch (err) {
    return { error: friendlyError(err, 'ปรับสต๊อกไม่สำเร็จ') }
  }
}
