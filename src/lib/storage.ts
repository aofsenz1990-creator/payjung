import 'server-only'
import { supabaseAdmin } from './supabase'

export const SLIP_BUCKET = 'slips'

/** ขนาดสูงสุดของรูปสลิปหลังย่อแล้ว (ฝั่งเบราว์เซอร์ย่อให้เหลือไม่กี่ร้อย KB อยู่แล้ว) */
const MAX_BYTES = 4 * 1024 * 1024

let bucketReady: Promise<void> | null = null

/** สร้าง bucket ให้อัตโนมัติครั้งแรก จะได้ไม่ต้องไปกดสร้างเองในหน้า Supabase */
function ensureBucket() {
  if (!bucketReady) {
    bucketReady = (async () => {
      const admin = supabaseAdmin()
      const { data } = await admin.storage.getBucket(SLIP_BUCKET)
      if (data) return
      const { error } = await admin.storage.createBucket(SLIP_BUCKET, {
        public: false, // ดูได้ผ่านลิงก์ชั่วคราวที่ระบบออกให้เท่านั้น
        fileSizeLimit: MAX_BYTES,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
      })
      // ถ้ามีคนสร้างพร้อมกันจนชนกัน ถือว่าผ่าน
      if (error && !/already exists/i.test(error.message)) throw error
    })().catch((err) => {
      bucketReady = null
      throw err
    })
  }
  return bucketReady
}

export class SlipError extends Error {}

/**
 * แปลง data URL ที่ฝั่งเบราว์เซอร์ส่งมาเป็นไฟล์ แล้วอัปโหลดขึ้น Supabase Storage
 * คืนค่าเป็น path ที่ใช้เก็บลงตาราง sales
 */
export async function uploadSlip(dataUrl: string, soldAtISO: string): Promise<string> {
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/)
  if (!match) throw new SlipError('ไฟล์สลิปไม่ถูกต้อง รองรับเฉพาะรูปภาพ JPG / PNG / WebP')

  const [, contentType, base64] = match
  const buffer = Buffer.from(base64, 'base64')
  if (buffer.byteLength === 0) throw new SlipError('ไฟล์สลิปว่างเปล่า')
  if (buffer.byteLength > MAX_BYTES) {
    throw new SlipError(`รูปสลิปใหญ่เกินไป (${Math.round(buffer.byteLength / 1024 / 1024)} MB)`)
  }

  await ensureBucket()

  const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg'
  const date = soldAtISO.slice(0, 7) // YYYY-MM
  const path = `${date}/${crypto.randomUUID()}.${ext}`

  const { error } = await supabaseAdmin()
    .storage.from(SLIP_BUCKET)
    .upload(path, buffer, { contentType, upsert: false })
  if (error) throw new SlipError(`อัปโหลดสลิปไม่สำเร็จ: ${error.message}`)

  return path
}

export const IMAGE_BUCKET = 'images'

let imageBucketReady: Promise<void> | null = null

/** bucket สำหรับรูปที่ต้องให้คนทั่วไปเห็นได้ เช่น รูปเกมบนหน้าเว็บลูกค้า */
function ensureImageBucket() {
  if (!imageBucketReady) {
    imageBucketReady = (async () => {
      const admin = supabaseAdmin()
      const { data } = await admin.storage.getBucket(IMAGE_BUCKET)
      if (data) return
      const { error } = await admin.storage.createBucket(IMAGE_BUCKET, {
        public: true, // รูปเกมต้องเปิดดูได้จากหน้าเว็บลูกค้าโดยตรง
        fileSizeLimit: MAX_BYTES,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
      })
      if (error && !/already exists/i.test(error.message)) throw error
    })().catch((err) => {
      imageBucketReady = null
      throw err
    })
  }
  return imageBucketReady
}

/**
 * อัปโหลดรูปที่เปิดดูได้สาธารณะ แล้วคืน URL เต็มไว้เก็บลงฐานข้อมูล
 * ใช้กับรูปเกมและรูปแพ็กเกจบนหน้าเว็บลูกค้า
 */
export async function uploadImage(dataUrl: string, folder = 'games'): Promise<string> {
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/)
  if (!match) throw new SlipError('ไฟล์รูปไม่ถูกต้อง รองรับเฉพาะ JPG / PNG / WebP')

  const [, contentType, base64] = match
  const buffer = Buffer.from(base64, 'base64')
  if (buffer.byteLength === 0) throw new SlipError('ไฟล์รูปว่างเปล่า')
  if (buffer.byteLength > MAX_BYTES) throw new SlipError('รูปใหญ่เกินไป')

  await ensureImageBucket()

  const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg'
  const path = `${folder}/${crypto.randomUUID()}.${ext}`

  const admin = supabaseAdmin()
  const { error } = await admin.storage
    .from(IMAGE_BUCKET)
    .upload(path, buffer, { contentType, upsert: false })
  if (error) throw new SlipError(`อัปโหลดรูปไม่สำเร็จ: ${error.message}`)

  return admin.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl
}

/** ลบสลิปทิ้ง ใช้ตอนบันทึกบิลไม่สำเร็จ จะได้ไม่มีไฟล์ค้าง */
export async function removeSlip(path: string) {
  try {
    await supabaseAdmin().storage.from(SLIP_BUCKET).remove([path])
  } catch {
    // ลบไม่ได้ก็ไม่เป็นไร ไม่ควรทำให้การบันทึกบิลล้มเหลวตาม
  }
}

/** ออกลิงก์ชั่วคราวสำหรับเปิดดูสลิป */
export async function signedSlipUrl(path: string, seconds = 300) {
  const { data, error } = await supabaseAdmin()
    .storage.from(SLIP_BUCKET)
    .createSignedUrl(path, seconds)
  if (error || !data) return null
  return data.signedUrl
}
