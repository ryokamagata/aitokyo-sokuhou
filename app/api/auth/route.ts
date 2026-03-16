import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { user, password } = await req.json()

  if (user === process.env.AUTH_USER && password === process.env.AUTH_PASSWORD) {
    const res = NextResponse.json({ success: true })
    res.cookies.set('aitokyo_session', process.env.AUTH_TOKEN!, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30, // 30日間
      path: '/',
    })
    return res
  }

  return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
}

export async function DELETE() {
  const res = NextResponse.json({ success: true })
  res.cookies.set('aitokyo_session', '', {
    httpOnly: true,
    maxAge: 0,
    path: '/',
  })
  return res
}
