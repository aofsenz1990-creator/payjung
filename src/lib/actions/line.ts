'use server'

import { randomInt } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { q } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { lineConfig, notifyLine } from '@/lib/line'
import { friendlyError, str } from '@/lib/form'
import type { ActionState } from '@/components/ActionForm'

/** เขียนค่าลง site_settings ทีละตัว */
async function setSetting(key: string, value: string) {
  await q(
    `insert into site_settings (key, value) values ($1, $2)
     on conflict (key) do update set value = excluded.value`,
    [key, value]
  )
}

/**
 * บันทึกคีย์ของ LINE
 * เว้นช่องว่างไว้ = ใช้ค่าเดิม จะได้ไม่ต้องหาคีย์มาวางใหม่ทุกครั้งที่แก้อย่างอื่น
 */
export async function saveLineSettingsAction(formData: FormData): Promise<ActionState> {
  await requireAdmin()
  const token = str(formData, 'line_channel_token')
  const secret = str(formData, 'line_channel_secret')

  try {
    if (token) await setSetting('line_channel_token', token)
    if (secret) await setSetting('line_channel_secret', secret)
  } catch (err) {
    return { error: friendlyError(err, 'บันทึกค่า LINE ไม่สำเร็จ') }
  }

  revalidatePath('/storefront')
  if (!token && !secret) return { ok: 'ไม่ได้กรอกอะไรมา — ค่าเดิมยังอยู่ครบ' }
  return { ok: 'บันทึกค่า LINE แล้ว — ขั้นต่อไปกดสร้างรหัสผูกด้านล่าง' }
}

/**
 * ตั้งปลายทางแจ้งเตือนด้วยการวางรหัสตรง ๆ
 *
 * หน้า LINE Developers แท็บ Basic settings มีบรรทัด "Your user ID" ให้คัดลอกได้เลย
 * ทางนี้เร็วกว่าการผูกด้วยรหัส 6 หลักมาก และไม่ต้องตั้ง webhook เลยด้วยซ้ำ
 * (เก็บวิธีผูกด้วยรหัสไว้เผื่อกรณีอยากส่งเข้ากลุ่ม ซึ่งกลุ่มไม่มีที่ให้ดูรหัส)
 */
export async function saveLineTargetAction(formData: FormData): Promise<ActionState> {
  await requireAdmin()
  const target = str(formData, 'line_target_id')

  if (!target) return { error: 'กรุณาวางรหัสปลายทาง (User ID)' }
  // U = คนเดียว, C = กลุ่ม, R = ห้องแชท — ของ LINE ยาว 33 ตัวเสมอ
  if (!/^[UCR][0-9a-f]{32}$/i.test(target)) {
    return {
      error: 'รูปแบบรหัสไม่ถูกต้อง — ต้องขึ้นต้นด้วย U แล้วตามด้วยตัวเลขผสมตัวอักษร 32 ตัว',
    }
  }

  try {
    await setSetting('line_target_id', target)
  } catch (err) {
    return { error: friendlyError(err, 'บันทึกปลายทางไม่สำเร็จ') }
  }

  revalidatePath('/storefront')
  return { ok: 'บันทึกปลายทางแล้ว — กดปุ่ม "ส่งข้อความทดสอบ" เพื่อยืนยันว่าใช้ได้จริง' }
}

/** สร้างรหัส 6 หลักสำหรับผูกปลายทางแจ้งเตือน ใช้ได้ 15 นาที */
export async function startLinePairingAction(): Promise<ActionState> {
  await requireAdmin()

  const { token, secret } = await lineConfig()
  if (!token || !secret) {
    return { error: 'กรุณากรอก Channel access token และ Channel secret ให้ครบก่อน' }
  }

  try {
    const code = String(randomInt(100000, 1000000))
    await setSetting('line_pair_code', code)
    await setSetting('line_pair_expires', String(Date.now() + 15 * 60 * 1000))
    revalidatePath('/storefront')
    return {
      ok: `รหัสผูกคือ ${code} — เปิดแอป LINE แล้วพิมพ์เลขนี้ทักไปหาบัญชีทางการของร้าน ภายใน 15 นาที`,
    }
  } catch (err) {
    return { error: friendlyError(err, 'สร้างรหัสผูกไม่สำเร็จ') }
  }
}

/**
 * ตรวจว่าคีย์ที่กรอกไว้ถูกต้องจริงไหม โดยยิงถามข้อมูลบัญชีจาก LINE
 *
 * ตรวจได้โดยไม่ต้องผูกปลายทางก่อน จึงใช้แยกปัญหาได้ว่า
 * "คีย์ผิด" หรือ "คีย์ถูกแต่ยังไม่ได้ผูกปลายทาง" ซึ่งสองอันนี้แก้คนละทาง
 */
export async function verifyLineKeysAction(): Promise<ActionState> {
  await requireAdmin()
  const { token, secret } = await lineConfig()

  if (!token) return { error: 'ยังไม่ได้บันทึก Channel access token' }
  if (!secret) return { error: 'ยังไม่ได้บันทึก Channel secret' }

  // Channel secret ของ LINE เป็นเลขฐานสิบหก 32 ตัวเสมอ ผิดรูปแบบ = วางผิดช่องแน่นอน
  const secretLooksRight = /^[0-9a-f]{32}$/i.test(secret)

  try {
    const res = await fetch('https://api.line.me/v2/bot/info', {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    })

    if (res.status === 401) {
      return {
        error:
          'Channel access token ไม่ถูกต้องหรือถูกยกเลิกไปแล้ว — ' +
          'ไปที่ LINE Developers แท็บ Messaging API แล้วกด Issue ใหม่ จากนั้นเอามาวางแล้วบันทึกอีกครั้ง',
      }
    }
    if (!res.ok) {
      return { error: `LINE ตอบกลับผิดปกติ (HTTP ${res.status}) ลองใหม่อีกครั้ง` }
    }

    const info = (await res.json()) as { displayName?: string; basicId?: string }
    const name = info.displayName ?? 'ไม่ทราบชื่อ'
    const basicId = info.basicId ?? ''

    return {
      ok:
        `✓ Channel access token ถูกต้อง — เชื่อมอยู่กับบัญชี "${name}" ${basicId}` +
        (secretLooksRight
          ? ' · Channel secret รูปแบบถูกต้อง'
          : ' · ⚠ แต่ Channel secret ผิดรูปแบบ (ต้องเป็นตัวอักษร a-f และตัวเลข รวม 32 ตัว) — น่าจะวางสลับช่องกัน'),
    }
  } catch {
    return { error: 'ติดต่อ LINE ไม่ได้ในตอนนี้ ลองใหม่อีกครั้ง' }
  }
}

/** ส่งข้อความทดสอบ เพื่อยืนยันว่าตั้งค่าครบจริง */
export async function testLineNotifyAction(): Promise<ActionState> {
  await requireAdmin()

  const { target } = await lineConfig()
  if (!target) return { error: 'ยังไม่ได้ผูกปลายทาง — กดสร้างรหัสผูกแล้วทักไปหา OA ก่อน' }

  const sent = await notifyLine(
    '🔔 ทดสอบการแจ้งเตือนจากร้าน Pay Jung\nถ้าเห็นข้อความนี้แปลว่าตั้งค่าเรียบร้อยแล้ว'
  )
  return sent
    ? { ok: 'ส่งข้อความทดสอบแล้ว — เช็กใน LINE ได้เลย' }
    : { error: 'ส่งไม่สำเร็จ — ตรวจว่า Channel access token ถูกต้องและยังไม่หมดอายุ' }
}

/** เลิกแจ้งเตือน (ล้างปลายทางทิ้ง) */
export async function unlinkLineAction(): Promise<ActionState> {
  await requireAdmin()
  try {
    await q(`update site_settings set value = '' where key = 'line_target_id'`)
    revalidatePath('/storefront')
    return { ok: 'ยกเลิกการแจ้งเตือนทาง LINE แล้ว' }
  } catch (err) {
    return { error: friendlyError(err) }
  }
}
