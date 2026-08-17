'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { q } from '@/lib/db'
import { getShopCustomer } from '@/lib/shop'
import { supabaseAdmin, supabaseServer } from '@/lib/supabase'
import { clip, customerError, optStr, str } from '@/lib/form'
import { tooMany, tooManyFromIp, TOO_MANY_MESSAGE } from '@/lib/ratelimit'
import type { ActionState } from '@/components/ActionForm'

/** ที่อยู่เว็บของเรา ใช้ประกอบลิงก์ตั้งรหัสใหม่ที่ส่งไปทางอีเมล */
async function siteOrigin() {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? ''
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

/**
 * ลูกค้าลืมรหัสผ่าน — ส่งลิงก์ตั้งรหัสใหม่ไปทางอีเมล
 *
 * ตอบข้อความเดียวกันเสมอไม่ว่าอีเมลนั้นจะมีในระบบหรือไม่
 * ถ้าตอบต่างกัน คนที่ไม่หวังดีจะไล่ยิงเพื่อหาว่าอีเมลไหนเป็นลูกค้าร้านเราบ้าง
 */
export async function requestPasswordResetAction(formData: FormData): Promise<ActionState> {
  const email = str(formData, 'email').toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: 'กรุณากรอกอีเมลให้ถูกต้อง' }
  }

  // อีเมลมีโควตาจำกัดและถูกใช้ยิงกวนคนอื่นได้ จึงต้องกันทั้งตามไอพีและตามอีเมล
  if (await tooManyFromIp('reset', 5, 3600)) return { error: TOO_MANY_MESSAGE }
  if (await tooMany(`reset:email:${email}`, 3, 3600)) return { error: TOO_MANY_MESSAGE }

  const done = {
    ok: 'ถ้าอีเมลนี้มีบัญชีอยู่ในระบบ เราส่งลิงก์ตั้งรหัสผ่านใหม่ไปให้แล้ว — กรุณาเช็กกล่องจดหมาย รวมถึงโฟลเดอร์ Junk / Spam ด้วย',
  }

  try {
    const supabase = await supabaseServer()
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${await siteOrigin()}/shop/reset/callback`,
    })
  } catch {
    // ส่งเมลไม่ได้ก็ยังตอบข้อความเดิม ไม่บอกใบ้ว่าอีเมลนี้มีในระบบไหม
    return done
  }

  return done
}

/**
 * ตั้งรหัสผ่านใหม่หลังกดลิงก์จากอีเมล
 *
 * ใช้สิทธิ์ระดับผู้ดูแลเปลี่ยนให้ แทนที่จะให้ตัวลูกค้าเปลี่ยนเอง
 * เพราะเราตั้งค่าความปลอดภัยใน Supabase ไว้ว่าการเปลี่ยนรหัสต้องยืนยันตัวตนก่อน
 * ซึ่งการมาถึงหน้านี้ได้ = ยืนยันผ่านลิงก์ในอีเมลแล้ว จึงถือว่ายืนยันตัวตนเรียบร้อย
 */
export async function setNewPasswordAction(formData: FormData): Promise<ActionState> {
  const password = str(formData, 'password')
  const confirm = str(formData, 'confirm')

  if (password.length < 8) return { error: 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร' }
  if (password !== confirm) return { error: 'รหัสผ่านสองช่องไม่ตรงกัน' }

  try {
    const supabase = await supabaseServer()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return {
        error: 'ลิงก์หมดอายุหรือถูกใช้ไปแล้ว กรุณากดขอลิงก์ใหม่อีกครั้งที่หน้าลืมรหัสผ่าน',
      }
    }

    const { error } = await supabaseAdmin().auth.admin.updateUserById(user.id, { password })
    if (error) return { error: 'ตั้งรหัสผ่านใหม่ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }
  } catch (err) {
    return { error: customerError(err, 'ตั้งรหัสผ่านใหม่ไม่สำเร็จ') }
  }

  redirect('/shop/me')
}

/** ลูกค้าแก้ข้อมูลของตัวเอง — แก้ได้เฉพาะข้อมูลติดต่อ ไม่แตะเครดิตหรือระดับลูกค้า */
export async function updateMyProfileAction(formData: FormData): Promise<ActionState> {
  const customer = await getShopCustomer()
  if (!customer) return { error: 'กรุณาเข้าสู่ระบบก่อน' }

  const name = clip(str(formData, 'name'), 80)
  const phone = optStr(formData, 'phone')
  const gameUid = optStr(formData, 'game_uid')

  if (!name) return { error: 'กรุณากรอกชื่อที่ใช้แสดง' }

  try {
    await q(
      'update customers set name = $1, phone = $2, game_uid = $3 where id = $4',
      [name, phone ? clip(phone, 30) : null, gameUid ? clip(gameUid, 120) : null, customer.id]
    )
  } catch (err) {
    return { error: customerError(err, 'บันทึกข้อมูลไม่สำเร็จ') }
  }

  revalidatePath('/shop/me')
  revalidatePath('/customers')
  return { ok: 'บันทึกข้อมูลเรียบร้อยแล้ว' }
}

/**
 * ลูกค้าเปลี่ยนรหัสผ่านเอง — ต้องกรอกรหัสเดิมให้ถูกก่อน
 *
 * ตรวจรหัสเดิมด้วยการลองล็อกอินจริง แล้วค่อยเปลี่ยนให้ด้วยสิทธิ์ผู้ดูแล
 * ถ้าไม่ตรวจรหัสเดิม ใครที่หยิบเครื่องลูกค้าไปตอนเปิดหน้าค้างไว้ จะยึดบัญชีได้ทันที
 */
export async function changeMyPasswordAction(formData: FormData): Promise<ActionState> {
  const customer = await getShopCustomer()
  if (!customer) return { error: 'กรุณาเข้าสู่ระบบก่อน' }

  const current = str(formData, 'current_password')
  const password = str(formData, 'password')
  const confirm = str(formData, 'confirm')

  if (!current) return { error: 'กรุณากรอกรหัสผ่านเดิม' }
  if (password.length < 8) return { error: 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร' }
  if (password !== confirm) return { error: 'รหัสผ่านใหม่สองช่องไม่ตรงกัน' }
  if (password === current) return { error: 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม' }

  // กันเดารหัสเดิมทีละตัวผ่านหน้านี้
  if (await tooMany(`change-pw:customer:${customer.id}`, 5, 900)) {
    return { error: TOO_MANY_MESSAGE }
  }

  try {
    const supabase = await supabaseServer()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user?.email) return { error: 'กรุณาเข้าสู่ระบบใหม่อีกครั้ง' }

    // ลองล็อกอินด้วยรหัสเดิมเพื่อยืนยันว่าเป็นเจ้าของบัญชีจริง
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: current,
    })
    if (verifyError) return { error: 'รหัสผ่านเดิมไม่ถูกต้อง' }

    const { error } = await supabaseAdmin().auth.admin.updateUserById(user.id, { password })
    if (error) return { error: 'เปลี่ยนรหัสผ่านไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }
  } catch (err) {
    return { error: customerError(err, 'เปลี่ยนรหัสผ่านไม่สำเร็จ') }
  }

  return { ok: 'เปลี่ยนรหัสผ่านเรียบร้อยแล้ว ครั้งหน้าเข้าสู่ระบบด้วยรหัสใหม่' }
}
