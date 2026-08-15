import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_PATHS = ['/login', '/setup']

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

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(list) {
        for (const { name, value } of list) request.cookies.set(name, value)
        response = NextResponse.next({ request })
        for (const { name, value, options } of list) response.cookies.set(name, value, options)
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

  if (user && pathname === '/login') {
    const target = request.nextUrl.clone()
    target.pathname = '/'
    target.search = ''
    const redirected = NextResponse.redirect(target)
    for (const cookie of response.cookies.getAll()) redirected.cookies.set(cookie)
    return redirected
  }

  return response
}

export const config = {
  // ข้ามไฟล์ static และ asset ทั้งหมด
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
}
