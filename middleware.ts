import { NextRequest, NextResponse } from 'next/server'

export function middleware(request: NextRequest) {
  const session = request.cookies.get('aitokyo_session')?.value
  const expected = process.env.AUTH_TOKEN

  if (!expected || session !== expected) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!login|api/auth|_next|favicon\\.ico).*)'],
}
