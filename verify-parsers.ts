// Verify parsers against real BM data for 2 stores
import { readFileSync } from 'fs'
import * as cheerio from 'cheerio'

const envContent = readFileSync('.env.local', 'utf-8')
for (const line of envContent.split('\n')) {
  const [key, ...rest] = line.split('=')
  if (key && rest.length) process.env[key.trim()] = rest.join('=').trim()
}

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

async function fetchFollowRedirects(url: string, init: RequestInit, cookies: Cookies, maxRedirects = 6) {
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

// Copy of parseVisitorHTML from bmScraper.ts
function parseVisitorHTML(html: string) {
  const $ = cheerio.load(html)
  const totals = { nominated: 0, free_visit: 0, new_customers: 0, revisit: 0, fixed: 0, re_return: 0 }
  const num = (text: string) => parseInt(text.replace(/[^0-9]/g, '')) || 0
  const metricMap: Record<string, keyof typeof totals> = {
    '指名件数': 'nominated',
    'フリー件数': 'free_visit',
    '新規': 'new_customers',
    '再来': 'revisit',
    '固定': 'fixed',
    'リターン': 're_return',
  }
  $('table').each((i, table) => {
    if (i === 0) return
    $(table).find('tr').each((__, tr) => {
      const cells = $(tr).find('td').map((___, td) => $(td).text().trim()).get()
      if (cells.length < 2) return
      const label = cells[0]
      const value = cells[1]
      for (const [keyword, key] of Object.entries(metricMap)) {
        if (label === keyword) {
          totals[key] = num(value)
        }
      }
    })
  })
  return totals
}

// Copy of parseUserHTML from bmScraper.ts
function parseUserHTML(html: string) {
  const $ = cheerio.load(html)
  let totalUsers = 0, appMembers = 0
  const num = (text: string) => parseInt(text.replace(/[^0-9]/g, '')) || 0
  $('table').each((i, table) => {
    if (i === 0) return
    const headers = $(table).find('thead th, thead td').map((__, el) => $(el).text().trim()).get()
    if (!headers.some(h => h.includes('顧客数'))) return
    const rows = $(table).find('tbody tr')
    rows.each((__, tr) => {
      const cells = $(tr).find('td').map((___, td) => $(td).text().trim()).get()
      if (cells.length >= 2) {
        totalUsers = num(cells[0])
        appMembers = num(cells[1])
        return false
      }
    })
    if (totalUsers > 0) return false
  })
  return { totalUsers, appMembers }
}

const STORES_TO_CHECK = [
  { name: 'AI TOKYO 渋谷', bm_code: '69110375' },
  { name: 'AI TOKYO Rita', bm_code: '11780846' },
  { name: "AI TOKYO men's 横浜", bm_code: '31132259' },
]

async function main() {
  const loginId = process.env.BM_LOGIN_ID!
  const password = process.env.BM_PASSWORD!

  console.log('=== Parser Verification ===\n')
  console.log('Logging in...')

  const { cookies: groupCookies } = await fetchFollowRedirects(
    `${BM_BASE}/groupmanage/login/`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ login_id: loginId, password }).toString(),
    },
    new Map()
  )

  const startDate = '2026-03-01'
  const endDate = '2026-03-16'
  const params = new URLSearchParams({
    periodType: '0', startDay: startDate, endDay: endDate,
    startYear: '2026', startMonth: '3', endYear: '2026', endMonth: '3', shopUserId: '',
  })

  const allVisitors: typeof STORES_TO_CHECK[0] & ReturnType<typeof parseVisitorHTML>[] = [] as any
  const allUsers: { store: string; totalUsers: number; appMembers: number }[] = []

  for (const store of STORES_TO_CHECK) {
    console.log(`\n--- ${store.name} (${store.bm_code}) ---`)

    const { cookies: storeCookies } = await fetchFollowRedirects(
      `${BM_BASE}/groupmanage/shoplogin/?bm_code=${store.bm_code}&now=${Date.now()}`,
      {},
      groupCookies
    )

    // Visitor
    const { response: visitorRes } = await fetchFollowRedirects(
      `${BM_BASE}/manage/analysis/visitor?${params.toString()}`, {}, storeCookies
    )
    const visitorHtml = await visitorRes.text()
    const visitor = parseVisitorHTML(visitorHtml)
    console.log('Visitor:', visitor)

    const nomRate = (visitor.nominated + visitor.free_visit) > 0
      ? ((visitor.nominated / (visitor.nominated + visitor.free_visit)) * 100).toFixed(1)
      : '0'
    const repTotal = visitor.revisit + visitor.fixed + visitor.re_return
    const repRate = (visitor.new_customers + repTotal) > 0
      ? ((repTotal / (visitor.new_customers + repTotal)) * 100).toFixed(1)
      : '0'
    console.log(`  指名率: ${nomRate}%  リピート率: ${repRate}%`)

    // User
    const { response: userRes } = await fetchFollowRedirects(
      `${BM_BASE}/manage/analysis/user?${params.toString()}`, {}, storeCookies
    )
    const userHtml = await userRes.text()
    const user = parseUserHTML(userHtml)
    console.log('User:', user)

    const appRate = user.totalUsers > 0 ? ((user.appMembers / user.totalUsers) * 100).toFixed(1) : '0'
    console.log(`  アプリ会員率: ${appRate}%`)

    allUsers.push({ store: store.name, ...user })

    await new Promise(r => setTimeout(r, 300))
  }

  console.log('\n=== Summary ===')
  console.log('Check these values match what BM shows for each store.')
  console.log('Rates should be averaged (not weighted) across all stores for the dashboard.')
}

main().catch(console.error)
