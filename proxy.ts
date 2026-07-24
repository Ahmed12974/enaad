import { NextResponse, type NextRequest } from 'next/server'
import { getSessionCookie } from 'better-auth/cookies'
import { getPlatformSettingsSafe } from '@/lib/platform-settings'

export async function proxy(request: NextRequest) {
  const settings = await getPlatformSettingsSafe()
  const path = request.nextUrl.pathname
  const maintenanceAllowed =
    path === '/sign-in' || path.startsWith('/auth/continue') || path.startsWith('/admin')
  if (settings.maintenanceMode && !maintenanceAllowed) {
    if (path.startsWith('/api/'))
      return NextResponse.json(
        { error: 'المنصة في وضع الصيانة المؤقتة.' },
        { status: 503, headers: { 'Retry-After': '300' } },
      )
    return NextResponse.redirect(new URL('/maintenance', request.url))
  }
  if (
    path === '/sign-in' ||
    path === '/sign-up' ||
    path.startsWith('/auth/continue') ||
    // The file route performs its own record-level authorization. Active public
    // banners must remain reachable without a session, while private certificates
    // are still rejected by the route itself.
    path === '/api/files'
  )
    return NextResponse.next()
  if (getSessionCookie(request, { cookiePrefix: 'lughati' })) return NextResponse.next()
  const signIn = new URL('/sign-in', request.url)
  signIn.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`)
  return NextResponse.redirect(signIn)
}

export const config = {
  matcher: [
    '/',
    '/account/:path*',
    '/achievements/:path*',
    '/add/:path*',
    '/admin/:path*',
    '/arabic/:path*',
    '/challenges/:path*',
    '/competitions/:path*',
    '/english/:path*',
    '/math/:path*',
    '/api/files',
    '/auth/continue',
    '/sign-in',
    '/sign-up',
    '/mistakes/:path*',
    '/quiz/:path*',
    '/results/:path*',
    '/sentences/:path*',
    '/study/:path*',
    '/words/:path*',
  ],
}
