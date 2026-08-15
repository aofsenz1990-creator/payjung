'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { q } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { decimal, friendlyError, int, optStr, str } from '@/lib/form'
import { todayISO } from '@/lib/format'
import type { ActionState } from '@/components/ActionForm'

export async function saveExpenseAction(formData: FormData): Promise<ActionState> {
  const user = await requireAdmin()
  const id = str(formData, 'id')
  const spentOn = str(formData, 'spent_on') || todayISO()
  const category = str(formData, 'category') || 'อื่น ๆ'
  const title = str(formData, 'title')
  const amount = decimal(formData, 'amount')
  const note = optStr(formData, 'note')

  if (!title) return { error: 'กรุณากรอกรายการค่าใช้จ่าย' }
  if (amount <= 0) return { error: 'จำนวนเงินต้องมากกว่า 0' }

  try {
    if (id) {
      await q(
        'update expenses set spent_on = $1, category = $2, title = $3, amount = $4, note = $5 where id = $6',
        [spentOn, category, title, amount, note, Number(id)]
      )
    } else {
      await q(
        `insert into expenses (spent_on, category, title, amount, note, created_by)
         values ($1, $2, $3, $4, $5, $6)`,
        [spentOn, category, title, amount, note, user.id]
      )
    }
  } catch (err) {
    return { error: friendlyError(err) }
  }

  revalidatePath('/expenses')
  revalidatePath('/')
  if (id) redirect('/expenses')
  return { ok: `บันทึกค่าใช้จ่าย "${title}" แล้ว` }
}

export async function deleteExpenseAction(formData: FormData) {
  await requireAdmin()
  await q('delete from expenses where id = $1', [int(formData, 'id')])
  revalidatePath('/expenses')
  revalidatePath('/')
}
