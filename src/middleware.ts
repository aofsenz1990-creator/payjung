import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, verifySession } from '@/lib/session'

const PUBLIC_PATHS = ['/login', '/setup']

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))

  let user = null
  try {
    user = await verifySession(request.cookies.get(SESSION_COOKIE)?.value)
  } catch {
    // AUTH_SECRET ยังไม่ได้ตั้ง — ปล่อยให้หน้า login แสดงข้อความบอกวิธีตั้งค่า
    user = null
  }

  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`
    return NextResponse.redirect(url)
  }

  if (user && pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    url.search = ''
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  // ข้ามไฟล์ static และ asset ทั้งหมด
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
}
