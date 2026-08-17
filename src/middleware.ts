import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { sessionCookieOptions } from '@/lib/cookies'

// /shop คือหน้าเว็บสำหรับลูกค้า มีระบบล็อกอินของตัวเองแยกจากหลังร้าน
// /api/provider-callback คือช่องที่ผู้ให้บริการยิงผลออเดอร์กลับมา ไม่มี session
// จึงต้องปล่อยผ่าน middleware — ตัวมันเองยืนยันด้วยกุญแจลับใน path อยู่แล้ว
const PUBLIC_PATHS = ['/login', '/setup', '/shop', '/api/provider-callback']

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))

  let response = NextResponse.next({ request })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY

  // ยังตั้งค่า Supabase ไม่ครบ — ปล่อยผ่านไปให้หน้า login อธิบายวิธีตั้งค่า
  if (!url || !key) return response

  // ไม่มี cookie ของ Supabase เลย = ยังไม่เคยล็อกอิน ไม่ต้องเสียเวลายิงถาม Supabase
  const hasAuthCookie = request.cookies.getAll().some((c) => c.name.startsWith('sb-'))
  if (!hasAuthCookie) {
    if (isPublic) return response
    const target = request.nextUrl.clone()
    target.pathname = '/login'
    target.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`
    return NextResponse.redirect(target)
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(list) {
        for (const { name, value } of list) request.cookies.set(name, value)
        response = NextResponse.next({ request })
        for (const { name, value, options } of list) {
          response.cookies.set(name, value, sessionCookieOptions(options ?? {}))
        }
      },
    },
  })

  // ต้องเรียก getUser() เสมอ เพื่อให้ Supabase ต่ออายุ token ให้อัตโนมัติ
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user && !isPublic) {
    const target = request.nextUrl.clone()
    target.pathname = '/login'
    target.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`
    const redirected = NextResponse.redirect(target)
    // พก cookie ที่เพิ่งต่ออายุไปด้วย ไม่งั้น session จะหลุด
    for (const cookie of response.cookies.getAll()) redirected.cookies.set(cookie)
    return redirected
  }

  // ไม่เด้งออกจากหน้า login เองแม้จะมี session เพราะ session อาจเป็นของ "ลูกค้า"
  // ที่ล็อกอินหน้าเว็บไว้ ซึ่งไม่มีสิทธิ์เข้าหลังร้าน ถ้าเด้งไปหน้าแรกจะวนกลับมาไม่จบ
  // ปล่อยให้หน้า login เช็กเองว่าเป็นพนักงานจริงไหมแล้วค่อยพาเข้าไป
  return response
}

export const config = {
  // ข้ามไฟล์ static และ asset ทั้งหมด
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
}
