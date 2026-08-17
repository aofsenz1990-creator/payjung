import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { q, q1 } from './db'

/**
 * แจ้งเตือนเข้า LINE ผ่าน Messaging API ของบัญชีทางการ (OA)
 *
 * ทำไมไม่ใช้ LINE Notify: LINE ปิดบริการ Notify ถาวรไปแล้วตั้งแต่มีนาคม 2025
 * ทางที่เหลือคือ Messaging API ซึ่งตั้งค่ายุ่งกว่าแต่ใช้ได้ระยะยาว
 *
 * ปลายทางที่ส่งหา (userId หรือ groupId) ได้มาจากการ "ผูก" ครั้งเดียว
 * โดยให้เจ้าของร้านทักรหัส 6 หลักไปหา OA แล้วระบบจดปลายทางไว้เอง
 * (LINE ไม่มีที่ให้ดู userId ของตัวเอง จึงต้องได้มาทางนี้เท่านั้น)
 */

export type LineConfig = {
  token: string | null
  secret: string | null
  target: string | null
}

export async function lineConfig(): Promise<LineConfig> {
  try {
    const rows = await q<{ key: string; value: string | null }>(
      `select key, value from site_settings
        where key in ('line_channel_token', 'line_channel_secret', 'line_target_id')`
    )
    const map = new Map(rows.map((r) => [r.key, r.value?.trim() || null]))
    return {
      token: map.get('line_channel_token') ?? null,
      secret: map.get('line_channel_secret') ?? null,
      target: map.get('line_target_id') ?? null,
    }
  } catch {
    return { token: null, secret: null, target: null }
  }
}

/** ตรวจว่ารีเควสต์มาจาก LINE จริง ไม่ใช่ใครก็ได้ที่เดา URL เจอ */
export function verifyLineSignature(secret: string, body: string, signature: string | null) {
  if (!signature) return false
  const expected = createHmac('sha256', secret).update(body).digest('base64')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * ส่งข้อความแจ้งเตือนเข้า LINE
 *
 * ห้าม throw เด็ดขาด — ตัวนี้ถูกเรียกต่อท้ายงานที่สำคัญกว่ามาก (ลูกค้าแจ้งโอนเงิน)
 * ถ้า LINE ล่มแล้วทำให้การแจ้งโอนล้มตาม ลูกค้าจะโอนเงินไปแล้วแต่ระบบไม่บันทึก
 */
export type LineMessage =
  | { type: 'text'; text: string }
  | { type: 'image'; originalContentUrl: string; previewImageUrl: string }

export async function notifyLine(text: string): Promise<boolean> {
  return notifyLineMessages([{ type: 'text', text: text.slice(0, 4900) }])
}

/**
 * ส่งได้หลายข้อความในครั้งเดียว เช่นข้อความ + รูปสลิป
 *
 * LINE นับ "หนึ่งครั้งที่กดส่ง" เป็น 1 ข้อความ ไม่ว่าจะแนบไปกี่ชิ้น
 * ส่งรวมทีเดียวจึงประหยัดโควตาฟรีกว่าแยกส่งทีละอัน (แพ็กฟรีมี 500 ข้อความ/เดือน)
 */
export async function notifyLineMessages(messages: LineMessage[]): Promise<boolean> {
  try {
    const { token, target } = await lineConfig()
    if (!token || !target || messages.length === 0) return false

    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ to: target, messages: messages.slice(0, 5) }),
      // ไม่ให้ค้างนานจนกิน quota เวลาทำงานของ Vercel
      signal: AbortSignal.timeout(8000),
    })
    return res.ok
  } catch {
    return false
  }
}

/** ตอบกลับข้อความที่ทักเข้ามา ใช้ตอนผูกบัญชีเพื่อยืนยันให้เจ้าของร้านเห็น */
export async function replyLine(token: string, replyToken: string, text: string) {
  try {
    await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
      signal: AbortSignal.timeout(8000),
    })
  } catch {
    // ตอบกลับไม่ได้ก็ไม่เป็นไร การผูกสำเร็จไปแล้ว
  }
}

/** อ่านรหัสผูกที่ยังไม่หมดอายุ (คืน null ถ้าไม่มีหรือหมดอายุแล้ว) */
export async function activePairCode(): Promise<string | null> {
  const row = await q1<{ code: string | null; expires: string | null }>(
    `select
       (select value from site_settings where key = 'line_pair_code') as code,
       (select value from site_settings where key = 'line_pair_expires') as expires`
  )
  if (!row?.code || !row.expires) return null
  if (Number(row.expires) < Date.now()) return null
  return row.code
}
