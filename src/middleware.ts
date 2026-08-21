import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { sessionCookieOptions } from '@/lib/cookies'
import { IDLE_LOGOUT_PARAM, SHOP_ACTIVITY_COOKIE, SHOP_IDLE_MS } from '@/lib/idle'

// /shop คือหน้าเว็บสำหรับลูกค้า มีระบบล็อกอินของตัวเองแยกจากหลังร้าน
// /api/provider-callback คือช่องที่ผู้ให้บริการยิงผลออเดอร์กลับมา ไม่มี session
// จึงต้องปล่อยผ่าน middleware — ตัวมันเองยืนยันด้วยกุญแจลับใน path อยู่แล้ว
// /api/line-webhook คือช่องที่ LINE ยิงเข้ามาเมื่อมีคนทักบัญชีทางการของร้าน
// ไม่มี session เช่นกัน — ตัวมันยืนยันด้วยลายเซ็นจาก Channel secret ของ LINE
// /api/daily-summary กับ /api/refresh-prices คืองานตามเวลาที่ Vercel Cron ยิงเข้ามา
// ไม่มี cookie ติดมาด้วย ถ้าไม่ปล่อยผ่านตรงนี้จะโดนเด้งไปหน้า login แล้วงานไม่เคยทำงานเลย
// ทั้งสองเส้นตรวจ CRON_SECRET ของตัวเองอยู่แล้ว
const PUBLIC_PATHS = [
  '/login',
  '/setup',
  '/shop',
  '/api/provider-callback',
  '/api/line-webhook',
  '/api/daily-summary',
  '/api/refresh-prices',
]

/** cookie ของ Supabase มีอายุยาว ตัวจับเวลาจึงต้องอยู่ได้นานเท่ากัน (เพดานของเบราว์เซอร์คือ 400 วัน) */
const ACTIVITY_COOKIE_MAX_AGE = 400 * 24 * 60 * 60

function expire(response: NextResponse, name: string) {
  response.cookies.set(name, '', sessionCookieOptions({ path: '/', maxAge: 0 }))
}

/**
 * ลบร่องรอยการล็อกอินทิ้งทั้งหมด = ออกจากระบบทันทีในสายตาของทุกหน้า
 * ต้องลบตัวจับเวลาไปด้วย ไม่งั้นพอล็อกอินใหม่จะเจอเวลาเก่าค้างอยู่แล้วโดนเตะออกซ้ำ
 */
function clearSession(request: NextRequest, response: NextResponse) {
  for (const cookie of request.cookies.getAll()) {
    if (cookie.name.startsWith('sb-')) expire(response, cookie.name)
  }
  expire(response, SHOP_ACTIVITY_COOKIE)
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  const isShop = pathname === '/shop' || pathname.startsWith('/shop/')

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
    if (!isPublic) {
      const target = request.nextUrl.clone()
      target.pathname = '/login'
      target.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`
      response = NextResponse.redirect(target)
    }
    // ไม่มี session อยู่แล้ว ล้างตัวจับเวลาที่ค้างจากรอบก่อนทิ้งเสีย
    // เพื่อให้การล็อกอินครั้งถัดไปเริ่มนับหนึ่งใหม่เสมอ
    if (request.cookies.has(SHOP_ACTIVITY_COOKIE)) expire(response, SHOP_ACTIVITY_COOKIE)
    return response
  }

  /* ---------- ออกจากระบบอัตโนมัติเมื่อลูกค้าทิ้งหน้าเว็บไว้เฉย ๆ ----------
     ตรวจก่อนคุยกับ Supabase เพราะถ้าหมดเวลาแล้วก็ไม่ต้องเสียเวลาต่ออายุ token
     ด่านนี้อยู่ฝั่งเซิร์ฟเวอร์ จึงกันได้แม้เบราว์เซอร์จะปิด JavaScript
     หรือปิดแท็บทิ้งไว้จนตัวจับเวลาฝั่งหน้าจอไม่ได้ทำงาน */
  const seenAt = Number(request.cookies.get(SHOP_ACTIVITY_COOKIE)?.value)
  const idleTooLong = Number.isFinite(seenAt) && seenAt > 0 && Date.now() - seenAt > SHOP_IDLE_MS

  if (isShop && idleTooLong) {
    // ถ้ายืนอยู่ที่หน้า login พร้อมป้ายบอกเหตุผลแล้ว แค่ล้าง cookie พอ
    // อย่าเด้งซ้ำอีก กันกรณีเบราว์เซอร์ไม่ยอมลบ cookie แล้วกลายเป็นวนไม่จบ
    const alreadyTold =
      pathname === '/shop/login' && request.nextUrl.searchParams.get(IDLE_LOGOUT_PARAM) === '1'

    if (alreadyTold) {
      clearSession(request, response)
      return response
    }

    const target = request.nextUrl.clone()
    target.pathname = '/shop/login'
    target.search = `?${IDLE_LOGOUT_PARAM}=1`
    const kicked = NextResponse.redirect(target)
    clearSession(request, kicked)
    return kicked
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

  // เปิดหน้าใหม่หรือกดปุ่มบนหน้าเว็บลูกค้า = ยังมีคนใช้งานอยู่จริง ต่อเวลาให้อีกรอบ
  // (นับเฉพาะฝั่ง /shop เพราะหลังร้านไม่ได้ใช้ระบบนี้)
  if (isShop && user) {
    response.cookies.set(
      SHOP_ACTIVITY_COOKIE,
      String(Date.now()),
      sessionCookieOptions({ path: '/', maxAge: ACTIVITY_COOKIE_MAX_AGE })
    )
  }

  // ไม่เด้งออกจากหน้า login เองแม้จะมี session เพราะ session อาจเป็นของ "ลูกค้า"
  // ที่ล็อกอินหน้าเว็บไว้ ซึ่งไม่มีสิทธิ์เข้าหลังร้าน ถ้าเด้งไปหน้าแรกจะวนกลับมาไม่จบ
  // ปล่อยให้หน้า login เช็กเองว่าเป็นพนักงานจริงไหมแล้วค่อยพาเข้าไป
  return response
}

export const config = {
  // ข้ามไฟล์ static และ asset ทั้งหมด
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
}
