// Full verification: test parsers on ALL 11 stores
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

// Parsers (exact copy from bmScraper.ts)
function parseVisitorHTML(html: string) {
  const $ = cheerio.load(html)
  const totals = { nominated: 0, free_visit: 0, new_customers: 0, revisit: 0, fixed: 0, re_return: 0 }
  const num = (text: string) => parseInt(text.replace(/[^0-9]/g, '')) || 0
  const metricMap: Record<string, keyof typeof totals> = {
    '指名件数': 'nominated', 'フリー件数': 'free_visit',
    '新規': 'new_customers', '再来': 'revisit', '固定': 'fixed', 'リターン': 're_return',
  }
  $('table').each((i, table) => {
    if (i === 0) return
    $(table).find('tr').each((__, tr) => {
      const cells = $(tr).find('td').map((___, td) => $(td).text().trim()).get()
      if (cells.length < 2) return
      for (const [keyword, key] of Object.entries(metricMap)) {
        if (cells[0] === keyword) totals[key] = num(cells[1])
      }
    })
  })
  return totals
}

function parseUserHTML(html: string) {
  const $ = cheerio.load(html)
  let totalUsers = 0, appMembers = 0
  const num = (text: string) => parseInt(text.replace(/[^0-9]/g, '')) || 0
  $('table').each((i, table) => {
    if (i === 0) return
    const headers = $(table).find('thead th, thead td').map((__, el) => $(el).text().trim()).get()
    if (!headers.some(h => h.includes('顧客数'))) return
    $(table).find('tbody tr').each((__, tr) => {
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

const STORES = [
  { name: 'AI TOKYO 渋谷', bm_code: '69110375' },
  { name: 'AI TOKYO Rita', bm_code: '11780846' },
  { name: 'AI TOKYO S', bm_code: '12479835' },
  { name: 'AI TOKYO 名古屋栄', bm_code: '28162229' },
  { name: "AI TOKYO men's 横浜", bm_code: '31132259' },
  { name: "AI TOKYO Ciel men's 横浜", bm_code: '27468498' },
  { name: "AI TOKYO men's 下北沢", bm_code: '46641695' },
  { name: "AI TOKYO men's 池袋", bm_code: '63811270' },
  { name: 'ams by AI TOKYO', bm_code: '94303402' },
  { name: 'AI TOKYO 名古屋 2nd', bm_code: '65211838' },
  { name: 'AITOKYO + Sea店 横浜', bm_code: '73245379' },
]

async function main() {
  console.log('=== Full 11-Store Verification ===\n')
  const { cookies: groupCookies } = await fetchFollowRedirects(
    `${BM_BASE}/groupmanage/login/`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ login_id: process.env.BM_LOGIN_ID!, password: process.env.BM_PASSWORD! }).toString() },
    new Map()
  )

  const startDate = '2026-03-01', endDate = '2026-03-16'
  const params = new URLSearchParams({
    periodType: '0', startDay: startDate, endDay: endDate,
    startYear: '2026', startMonth: '3', endYear: '2026', endMonth: '3', shopUserId: '',
  })

  type StoreResult = {
    name: string; nominated: number; free_visit: number; new_customers: number
    revisit: number; fixed: number; re_return: number
    totalUsers: number; appMembers: number
    nomRate: number; repRate: number; appRate: number
  }
  const results: StoreResult[] = []

  for (const store of STORES) {
    process.stdout.write(`${store.name}... `)
    try {
      const { cookies: storeCookies } = await fetchFollowRedirects(
        `${BM_BASE}/groupmanage/shoplogin/?bm_code=${store.bm_code}&now=${Date.now()}`, {}, groupCookies
      )

      const { response: vRes } = await fetchFollowRedirects(
        `${BM_BASE}/manage/analysis/visitor?${params}`, {}, storeCookies
      )
      const v = parseVisitorHTML(await vRes.text())

      await new Promise(r => setTimeout(r, 300))

      const { response: uRes } = await fetchFollowRedirects(
        `${BM_BASE}/manage/analysis/user?${params}`, {}, storeCookies
      )
      const u = parseUserHTML(await uRes.text())

      const nomRate = (v.nominated + v.free_visit) > 0 ? (v.nominated / (v.nominated + v.free_visit)) * 100 : 0
      const repTotal = v.revisit + v.fixed + v.re_return
      const repRate = (v.new_customers + repTotal) > 0 ? (repTotal / (v.new_customers + repTotal)) * 100 : 0
      const appRate = u.totalUsers > 0 ? (u.appMembers / u.totalUsers) * 100 : 0

      results.push({ name: store.name, ...v, ...u, nomRate, repRate, appRate })
      console.log(`指名${v.nominated} フリー${v.free_visit} 新規${v.new_customers} 再来${v.revisit} 固定${v.fixed} リターン${v.re_return} | 顧客${u.totalUsers} アプリ${u.appMembers}`)

      await new Promise(r => setTimeout(r, 400))
    } catch (e) {
      console.log(`ERROR: ${e instanceof Error ? e.message : e}`)
    }
  }

  console.log('\n=== DASHBOARD EXPECTED VALUES ===')
  const totNom = results.reduce((s, r) => s + r.nominated, 0)
  const totFree = results.reduce((s, r) => s + r.free_visit, 0)
  const totNew = results.reduce((s, r) => s + r.new_customers, 0)
  const totUsers = results.reduce((s, r) => s + r.totalUsers, 0)
  const totApp = results.reduce((s, r) => s + r.appMembers, 0)

  const avgNomRate = results.filter(r => r.nomRate > 0).reduce((s, r) => s + r.nomRate, 0) / results.filter(r => r.nomRate > 0).length
  const avgRepRate = results.filter(r => r.repRate > 0).reduce((s, r) => s + r.repRate, 0) / results.filter(r => r.repRate > 0).length
  const avgAppRate = results.filter(r => r.appRate > 0).reduce((s, r) => s + r.appRate, 0) / results.filter(r => r.appRate > 0).length

  console.log(`指名客数: ${totNom}人`)
  console.log(`フリー客数: ${totFree}人`)
  console.log(`新規人数: ${totNew}人`)
  console.log(`新規着地予測: ${Math.round((totNew / 16) * 31)}人 (16日→31日)`)
  console.log(`指名率 (店舗平均): ${avgNomRate.toFixed(1)}%`)
  console.log(`リピート率 (店舗平均): ${avgRepRate.toFixed(1)}%`)
  console.log(`総顧客数: ${totUsers}人`)
  console.log(`アプリ会員数: ${totApp}人`)
  console.log(`アプリ会員率 (店舗平均): ${avgAppRate.toFixed(1)}%`)
}

main().catch(console.error)
