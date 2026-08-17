import { NextResponse, type NextRequest } from 'next/server'
import { supabaseServer } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * ปลายทางของลิงก์ตั้งรหัสผ่านใหม่ที่ส่งไปทางอีเมล
 *
 * ต้องเป็น route แยกแบบนี้ ไม่ใช่หน้าเว็บธรรมดา เพราะขั้นตอนแลกโค้ดเป็น session
 * ต้อง "เขียน cookie" ซึ่ง Server Component ทำไม่ได้ ถ้าไปแลกในหน้าเว็บ
 * session จะหายทันทีที่กดบันทึก แล้วลูกค้าจะเจอ "ลิงก์หมดอายุ" ทั้งที่ลิงก์ยังดีอยู่
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  const errorDescription = searchParams.get('error_description')

  if (errorDescription || !code) {
    return NextResponse.redirect(`${origin}/shop/reset?problem=1`)
  }

  try {
    const supabase = await supabaseServer()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) return NextResponse.redirect(`${origin}/shop/reset?problem=1`)
  } catch {
    return NextResponse.redirect(`${origin}/shop/reset?problem=1`)
  }

  return NextResponse.redirect(`${origin}/shop/reset`)
}
