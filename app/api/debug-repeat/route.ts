import { NextResponse } from 'next/server'

export const revalidate = 0

const BM_BASE = 'https://b-merit.jp'

type Cookies = Map<string, string>

function extractSetCookies(res: Response): string[] {
  const headers = res.headers as unknown as Record<string, unknown>
  if (typeof headers['getSetCookie'] === 'function') {
    return (headers['getSetCookie'] as () => string[])()
  }
  const raw = res.headers.get('set-cookie')
  if (!raw) return []
  return raw.split(/,(?=[^;]+=[^;]+)/).map((c) => c.trim())
}

function cookiesFromResponse(res: Response): Cookies {
  const map: Cookies = new Map()
  for (const raw of extractSetCookies(res)) {
    const kv = raw.split(';')[0].trim()
    const eq = kv.indexOf('=')
    if (eq > 0) map.set(kv.substring(0, eq), kv)
  }
  return map
}

function mergeCookies(base: Cookies, updates: Cookies): Cookies {
  const merged = new Map(base)
  Array.from(updates.entries()).forEach(([k, v]) => merged.set(k, v))
  return merged
}

function cookieHeader(cookies: Cookies): string {
  return Array.from(cookies.values()).join('; ')
}

async function fetchFollowRedirects(
  url: string,
  init: RequestInit,
  cookies: Cookies,
  maxRedirects = 6
): Promise<{ response: Response; cookies: Cookies }> {
  let currentUrl = url
  let currentCookies = new Map(cookies)
  for (let i = 0; i <= maxRedirects; i++) {
    const res = await fetch(currentUrl, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), Cookie: cookieHeader(currentCookies) },
      redirect: 'manual',
    })
    currentCookies = mergeCookies(currentCookies, cookiesFromResponse(res))
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) break
      currentUrl = loc.startsWith('http') ? loc : `${BM_BASE}${loc}`
      init = {}
    } else {
      return { response: res, cookies: currentCookies }
    }
  }
  const res = await fetch(currentUrl, { headers: { Cookie: cookieHeader(currentCookies) } })
  return { response: res, cookies: currentCookies }
}

export async function GET() {
  const loginId = process.env.BM_LOGIN_ID
  const password = process.env.BM_PASSWORD
  if (!loginId || !password) {
    return NextResponse.json({ error: 'BM credentials not set' }, { status: 500 })
  }

  try {
    // Login
    const { cookies: groupCookies } = await fetchFollowRedirects(
      `${BM_BASE}/groupmanage/login/`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ login_id: loginId, password }).toString(),
      },
      new Map()
    )

    // Login to first store (AI TOKYO 渋谷)
    const bmCode = '69110375'
    const { cookies: storeCookies } = await fetchFollowRedirects(
      `${BM_BASE}/groupmanage/shoplogin/?bm_code=${bmCode}&now=${Date.now()}`,
      {},
      groupCookies
    )

    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
    const year = now.getFullYear()
    const month = now.getMonth() + 1

    // Repeat page: query 3 months ago so BM has enough data
    const refMonth = month <= 3 ? month + 9 : month - 3
    const refYear = month <= 3 ? year - 1 : year

    const cheerio = await import('cheerio')

    // Fetch repeat page with params for 3 months ago
    const repeatParams = new URLSearchParams({
      periodType: '0',
      startDay: `${refYear}-${String(refMonth).padStart(2, '0')}-01`,
      endDay: `${refYear}-${String(refMonth).padStart(2, '0')}-28`,
      startYear: String(refYear),
      startMonth: String(refMonth),
      endYear: String(refYear),
      endMonth: String(refMonth),
      shopUserId: '',
    })
    const repeatUrl = `${BM_BASE}/manage/analysis/repeat?${repeatParams.toString()}`
    const { response: repeatRes } = await fetchFollowRedirects(repeatUrl, {}, storeCookies)
    const repeatHtml = await repeatRes.text()

    const $r = cheerio.load(repeatHtml)
    const repeatTables: { tableIndex: number; rows: string[][] }[] = []
    $r('table').each((i, table) => {
      const rows: string[][] = []
      $r(table).find('tr').each((_, tr) => {
        const cells = $r(tr).find('td, th').map((__, el) => $r(el).text().trim()).get()
        rows.push(cells)
      })
      repeatTables.push({ tableIndex: i, rows: rows.slice(0, 30) }) // first 30 rows
    })

    // Also fetch cycle page
    const cycleParams = new URLSearchParams({
      periodType: '0',
      startDay: `${refYear}-${String(refMonth).padStart(2, '0')}-01`,
      endDay: `${refYear}-${String(refMonth).padStart(2, '0')}-28`,
      startYear: String(refYear),
      startMonth: String(refMonth),
      endYear: String(refYear),
      endMonth: String(refMonth),
      shopUserId: '',
    })
    await new Promise((r) => setTimeout(r, 300))
    const cycleUrl = `${BM_BASE}/manage/analysis/cycle?${cycleParams.toString()}`
    const { response: cycleRes } = await fetchFollowRedirects(cycleUrl, {}, storeCookies)
    const cycleHtml = await cycleRes.text()

    const $c = cheerio.load(cycleHtml)
    const cycleTables: { tableIndex: number; rows: string[][] }[] = []
    $c('table').each((i, table) => {
      const rows: string[][] = []
      $c(table).find('tr').each((_, tr) => {
        const cells = $c(tr).find('td, th').map((__, el) => $c(el).text().trim()).get()
        rows.push(cells)
      })
      cycleTables.push({ tableIndex: i, rows: rows.slice(0, 30) })
    })

    // Also look for any divs/sections with リターン率
    let returnRateText = ''
    $r('*').each((_, el) => {
      const text = $r(el).text()
      if (/リターン率/.test(text) && text.length < 200) {
        returnRateText += text + '\n'
      }
    })
    $c('*').each((_, el) => {
      const text = $c(el).text()
      if (/リターン率/.test(text) && text.length < 200) {
        returnRateText += '[cycle] ' + text + '\n'
      }
    })

    return NextResponse.json({
      store: 'AI TOKYO 渋谷',
      refPeriod: `${refYear}年${refMonth}月`,
      repeatTables,
      cycleTables,
      returnRateText: returnRateText || 'No リターン率 text found',
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
