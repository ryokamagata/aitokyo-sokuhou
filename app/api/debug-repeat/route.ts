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
    const today = now.getDate() - 1
    const mm = String(month).padStart(2, '0')
    const dd = String(today).padStart(2, '0')
    const startDate = `${year}-${mm}-01`
    const endDate = `${year}-${mm}-${dd}`

    // Try multiple possible URLs for repeat/cycle analysis
    const typesToTry = ['repeat', 'cycle', 'revisit', 'retention']
    const results: Record<string, { status: number; htmlSnippet: string; tableCount: number; headers: string[][] }> = {}

    for (const type of typesToTry) {
      try {
        const params = new URLSearchParams({
          periodType: '0',
          startDay: startDate,
          endDay: endDate,
          startYear: String(year),
          startMonth: String(month),
          endYear: String(year),
          endMonth: String(month),
          shopUserId: '',
        })
        const url = `${BM_BASE}/manage/analysis/${type}?${params.toString()}`
        const { response } = await fetchFollowRedirects(url, {}, storeCookies)
        const html = await response.text()

        // Parse tables
        const cheerio = await import('cheerio')
        const $ = cheerio.load(html)
        const tables: string[][] = []
        $('table').each((i, table) => {
          const headers: string[] = []
          $(table).find('thead tr').last().find('th, td').each((_, el) => {
            headers.push($(el).text().trim())
          })
          if (headers.length === 0) {
            $(table).find('tr').first().find('th, td').each((_, el) => {
              headers.push($(el).text().trim())
            })
          }
          tables.push(headers)
        })

        // Get all text content from tables (first 3000 chars)
        let allTableText = ''
        $('table').each((i, table) => {
          allTableText += `\n--- TABLE ${i} ---\n`
          $(table).find('tr').each((_, tr) => {
            const cells = $(tr).find('td, th').map((__, el) => $(el).text().trim()).get()
            allTableText += cells.join(' | ') + '\n'
          })
        })

        results[type] = {
          status: response.status,
          htmlSnippet: allTableText.slice(0, 5000),
          tableCount: tables.length,
          headers: tables,
        }
        await new Promise((r) => setTimeout(r, 300))
      } catch (e) {
        results[type] = {
          status: 0,
          htmlSnippet: e instanceof Error ? e.message : String(e),
          tableCount: 0,
          headers: [],
        }
      }
    }

    return NextResponse.json({
      store: 'AI TOKYO 渋谷',
      dateRange: `${startDate} ~ ${endDate}`,
      results,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
