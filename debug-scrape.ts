// Debug script: fetch visitor and user pages from BM and print raw HTML structure
import { readFileSync } from 'fs'
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

async function main() {
  const loginId = process.env.BM_LOGIN_ID!
  const password = process.env.BM_PASSWORD!
  console.log('Logging in to BM group...')

  const { cookies: groupCookies } = await fetchFollowRedirects(
    `${BM_BASE}/groupmanage/login/`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ login_id: loginId, password }).toString(),
    },
    new Map()
  )
  console.log('Group login OK, cookies:', groupCookies.size)

  // Login to first store (渋谷)
  const bmCode = '69110375'
  const { cookies: storeCookies } = await fetchFollowRedirects(
    `${BM_BASE}/groupmanage/shoplogin/?bm_code=${bmCode}&now=${Date.now()}`,
    {},
    groupCookies
  )
  console.log('Store login OK')

  const startDate = '2026-03-01'
  const endDate = '2026-03-16'
  const params = new URLSearchParams({
    periodType: '0',
    startDay: startDate,
    endDay: endDate,
    startYear: '2026',
    startMonth: '3',
    endYear: '2026',
    endMonth: '3',
    shopUserId: '',
  })

  // Fetch visitor page
  console.log('\n=== VISITOR PAGE ===')
  const { response: visitorRes } = await fetchFollowRedirects(
    `${BM_BASE}/manage/analysis/visitor?${params.toString()}`,
    {},
    storeCookies
  )
  const visitorHtml = await visitorRes.text()
  console.log('Status:', visitorRes.status)
  console.log('URL:', visitorRes.url)

  const cheerio = await import('cheerio')
  const $v = cheerio.load(visitorHtml)
  console.log('Total tables:', $v('table').length)
  $v('table').each((i, table) => {
    if (i === 0) return // skip form table
    console.log(`\n--- Table ${i} ---`)
    console.log('Raw HTML (first 2000 chars):', $v(table).html()?.slice(0, 2000))
  })

  // Fetch user page
  console.log('\n=== USER PAGE ===')
  const { response: userRes } = await fetchFollowRedirects(
    `${BM_BASE}/manage/analysis/user?${params.toString()}`,
    {},
    storeCookies
  )
  const userHtml = await userRes.text()
  console.log('Status:', userRes.status)

  const $u = cheerio.load(userHtml)
  console.log('Total tables:', $u('table').length)
  $u('table').each((i, table) => {
    if (i === 0) return
    console.log(`\n--- User Table ${i} ---`)
    console.log('Raw HTML (first 2000 chars):', $u(table).html()?.slice(0, 2000))
  })
}

main().catch(console.error)
