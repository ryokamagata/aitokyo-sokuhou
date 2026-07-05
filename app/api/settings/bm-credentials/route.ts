import { NextRequest, NextResponse } from 'next/server'
import { getSetting, setSetting } from '@/lib/db'
import { verifyBmLogin } from '@/lib/bmScraper'

export const dynamic = 'force-dynamic'

// 認証情報を扱うため、このルートだけはセッションcookieを必須にする
function authorized(req: NextRequest): boolean {
  const session = req.cookies.get('aitokyo_session')?.value
  const expected = process.env.AUTH_TOKEN
  return !!expected && session === expected
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const loginId = getSetting('bm_login_id') ?? process.env.BM_LOGIN_ID ?? ''
  // パスワード本体は返さない。どこから読まれているかだけ返す
  const passwordSource = getSetting('bm_password') ? 'db' : process.env.BM_PASSWORD ? 'env' : 'none'
  const updatedAt = getSetting('bm_credentials_updated_at')
  return NextResponse.json({ loginId, passwordSource, updatedAt })
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { loginId?: string; password?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const loginId =
    (body.loginId ?? '').trim() || getSetting('bm_login_id') || process.env.BM_LOGIN_ID || ''
  const password = body.password ?? ''
  if (!loginId || !password) {
    return NextResponse.json({ error: 'ログインIDとパスワードを入力してください' }, { status: 400 })
  }

  // 保存前にBMへ実際にログインして検証（間違ったパスワードを保存させない）
  const check = await verifyBmLogin(loginId, password)
  if (!check.ok) {
    return NextResponse.json(
      { error: `BMログインに失敗しました: ${check.error}` },
      { status: 400 }
    )
  }

  setSetting('bm_login_id', loginId)
  setSetting('bm_password', password)
  setSetting('bm_credentials_updated_at', new Date().toISOString())
  return NextResponse.json({ ok: true })
}
