import * as cheerio from 'cheerio'
import {
  upsertStoreDailySales,
  upsertStaffSales,
  upsertMonthlyVisitors,
  upsertMonthlyUsers,
} from './db'
import { STORES } from './stores'

export { STORES }

const BM_BASE = 'https://b-merit.jp'

// ─── Cookie management ────────────────────────────────────────────────────────

type Cookies = Map<string, string> // name → "name=value"

function extractSetCookies(res: Response): string[] {
  const headers = res.headers as unknown as Record<string, unknown>
  if (typeof headers['getSetCookie'] === 'function') {
    return (headers['getSetCookie'] as () => string[])()
  }
  const raw = res.headers.get('set-cookie')
  if (!raw) return []
  // Split multiple cookies (comma-separated, but cookies can contain commas in expires)
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

// ─── Fetch helper with redirect chain + cookie forwarding ─────────────────────

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
      // Follow with GET
      init = {}
    } else {
      return { response: res, cookies: currentCookies }
    }
  }

  // Final attempt (shouldn't reach here normally)
  const res = await fetch(currentUrl, {
    headers: { Cookie: cookieHeader(currentCookies) },
  })
  return { response: res, cookies: currentCookies }
}

// ─── BM auth ─────────────────────────────────────────────────────────────────

async function loginGroup(): Promise<Cookies> {
  const loginId = process.env.BM_LOGIN_ID
  const password = process.env.BM_PASSWORD
  if (!loginId || !password) throw new Error('BM_LOGIN_ID / BM_PASSWORD env vars not set')

  const { cookies } = await fetchFollowRedirects(
    `${BM_BASE}/groupmanage/login/`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ login_id: loginId, password }).toString(),
    },
    new Map()
  )

  if (cookies.size === 0) throw new Error('Group login failed: no cookies returned')
  return cookies
}

async function loginStore(groupCookies: Cookies, bmCode: string): Promise<Cookies> {
  const url = `${BM_BASE}/groupmanage/shoplogin/?bm_code=${bmCode}&now=${Date.now()}`
  const { cookies } = await fetchFollowRedirects(url, {}, groupCookies)
  return cookies
}

// ─── HTML parsing ─────────────────────────────────────────────────────────────

function parseAmount(text: string): number {
  // "282,810 円" → 282810 | "-3,780 円" → -3780 | "29" → 29
  const cleaned = text.replace(/[^\d-]/g, '')
  return parseInt(cleaned) || 0
}

function parseDailyHTML(html: string): { date: string; sales: number; customers: number }[] {
  const $ = cheerio.load(html)
  const results: { date: string; sales: number; customers: number }[] = []

  $('table').eq(1).find('tbody tr').each((_, tr) => {
    const cells = $(tr)
      .find('td')
      .map((_, td) => $(td).text().trim())
      .get()

    if (cells.length < 9) return

    const dateMatch = cells[0].match(/(\d{4}-\d{2}-\d{2})/)
    if (!dateMatch) return

    results.push({
      date: dateMatch[1],
      sales: parseAmount(cells[1]),      // 純売上
      customers: parseAmount(cells[8]),  // 総客数
    })
  })

  return results
}

function parseStaffHTML(html: string): { staff: string; sales: number }[] {
  const $ = cheerio.load(html)
  const results: { staff: string; sales: number }[] = []

  $('table').eq(1).find('tbody tr').each((_, tr) => {
    const cells = $(tr)
      .find('td')
      .map((_, td) => $(td).text().trim())
      .get()

    if (cells.length < 2) return

    const name = cells[0].trim()
    if (!name || /合計|小計|^\s*$/.test(name)) return

    const sales = parseAmount(cells[1])
    if (sales <= 0) return

    results.push({ staff: name, sales })
  })

  return results
}

// ─── BM Analysis page fetch helper ───────────────────────────────────────────

function buildAnalysisParams(startDate: string, endDate: string): URLSearchParams {
  const [sy, sm] = startDate.split('-')
  const [ey, em] = endDate.split('-')
  return new URLSearchParams({
    periodType: '0',
    startDay: startDate,
    endDay: endDate,
    startYear: sy,
    startMonth: String(parseInt(sm)),
    endYear: ey,
    endMonth: String(parseInt(em)),
    shopUserId: '',
  })
}

async function fetchAnalysisPage(
  cookies: Cookies,
  type: string,
  startDate: string,
  endDate: string
): Promise<string> {
  const params = buildAnalysisParams(startDate, endDate)
  const url = `${BM_BASE}/manage/analysis/${type}?${params.toString()}`
  const { response } = await fetchFollowRedirects(url, {}, cookies)
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${type}`)
  return response.text()
}

// ─── Visitor parsing ─────────────────────────────────────────────────────────

interface VisitorResult {
  daily: Map<string, number>  // date → new_customers (for per-day tracking)
  totals: { nominated: number; free_visit: number; new_customers: number; revisit: number; fixed: number; re_return: number }
}

function parseVisitorHTML(html: string): VisitorResult {
  const $ = cheerio.load(html)
  const daily = new Map<string, number>()
  const totals = { nominated: 0, free_visit: 0, new_customers: 0, revisit: 0, fixed: 0, re_return: 0 }

  $('table').each((_, table) => {
    const headerCells = $(table).find('thead th, thead td, tr:first-child th, tr:first-child td')
    const headers = headerCells.map((__, el) => $(el).text().trim()).get()

    const idx = (name: string) => headers.findIndex(h => h.includes(name))
    const nominatedIdx = idx('指名件数')
    const freeIdx = idx('フリー件数')
    const newIdx = idx('新規')
    const revisitIdx = idx('再来')
    const fixedIdx = idx('固定')
    const reReturnIdx = idx('リターン')

    if (newIdx === -1) return // not the right table

    const num = (cells: string[], i: number) =>
      i >= 0 && i < cells.length ? (parseInt((cells[i] || '0').replace(/[^0-9]/g, '')) || 0) : 0

    const allRows = $(table).find('tbody tr, tr')
    allRows.each((__, tr) => {
      const cells = $(tr).find('td').map((___, td) => $(td).text().trim()).get()
      if (cells.length <= newIdx) return

      // 合計 row → extract totals
      if (/合計/.test(cells[0] || '')) {
        totals.nominated = num(cells, nominatedIdx)
        totals.free_visit = num(cells, freeIdx)
        totals.new_customers = num(cells, newIdx)
        totals.revisit = num(cells, revisitIdx)
        totals.fixed = num(cells, fixedIdx)
        totals.re_return = num(cells, reReturnIdx)
        return
      }

      // Per-day rows → extract new_customers
      const dateMatch = cells[0]?.match(/(\d{4}-\d{2}-\d{2})/)
      if (dateMatch) {
        daily.set(dateMatch[1], num(cells, newIdx))
      }
    })

    if (daily.size > 0 || totals.new_customers > 0) return false // break
  })

  return { daily, totals }
}

// ─── User (顧客) parsing ─────────────────────────────────────────────────────

function parseUserHTML(html: string): { totalUsers: number; appMembers: number } {
  const $ = cheerio.load(html)
  let totalUsers = 0, appMembers = 0

  $('table').each((_, table) => {
    const headerCells = $(table).find('thead th, thead td, tr:first-child th, tr:first-child td')
    const headers = headerCells.map((__, el) => $(el).text().trim()).get()

    const kokyakuIdx = headers.findIndex(h => h.includes('顧客数'))
    const appIdx = headers.findIndex(h => h.includes('アプリ会員数'))
    if (kokyakuIdx === -1) return

    // Use last data row (latest date)
    const rows = $(table).find('tbody tr, tr')
    let lastCells: string[] = []
    rows.each((__, tr) => {
      const cells = $(tr).find('td').map((___, td) => $(td).text().trim()).get()
      if (cells.length > kokyakuIdx && cells[0] && !/合計/.test(cells[0])) {
        lastCells = cells
      }
    })

    if (lastCells.length > 0) {
      totalUsers = parseInt((lastCells[kokyakuIdx] || '0').replace(/[^0-9]/g, '')) || 0
      appMembers = appIdx >= 0 ? (parseInt((lastCells[appIdx] || '0').replace(/[^0-9]/g, '')) || 0) : 0
      return false // break
    }
  })

  return { totalUsers, appMembers }
}

// ─── Analysis fetch ───────────────────────────────────────────────────────────

async function fetchAnalysis(
  cookies: Cookies,
  target: 'date' | 'stylist',
  startDate: string,
  endDate: string
): Promise<string> {
  const params = new URLSearchParams({
    action: 'aggregate',
    target,
    start_date: startDate,
    end_date: endDate,
    shop_user_type: '0',
    by_payment: '0',
    search: '検索',
  })
  const url = `${BM_BASE}/manage/account/analysis/?${params.toString()}`
  const res = await fetch(url, { headers: { Cookie: cookieHeader(cookies) } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${target}`)
  return res.text()
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

export interface ScrapeProgress {
  phase: string
  current: number
  total: number
  storeName?: string
  detail?: string
}

export interface ScrapeResult {
  storesScraped: number
  recordsStored: number
  errors: string[]
}

export async function scrapeAllStores(
  year: number,
  month: number,
  today: number,
  onProgress?: (p: ScrapeProgress) => void
): Promise<ScrapeResult> {
  const mm = String(month).padStart(2, '0')
  const dd = String(today).padStart(2, '0')
  const startDate = `${year}-${mm}-01`
  const endDate = `${year}-${mm}-${dd}`

  onProgress?.({ phase: 'login', current: 0, total: STORES.length, detail: 'BMにログイン中...' })
  const groupCookies = await loginGroup()

  let storesScraped = 0
  let recordsStored = 0
  const errors: string[] = []

  for (let i = 0; i < STORES.length; i++) {
    const store = STORES[i]
    onProgress?.({ phase: 'scraping', current: i + 1, total: STORES.length, storeName: store.name })
    try {
      const storeCookies = await loginStore(groupCookies, store.bm_code)

      // Daily sales
      const dailyHtml = await fetchAnalysis(storeCookies, 'date', startDate, endDate)
      const dailyRows = parseDailyHTML(dailyHtml)

      // Visitor (来店客分析)
      let newCustomerMap = new Map<string, number>()
      try {
        const visitorHtml = await fetchAnalysisPage(storeCookies, 'visitor', startDate, endDate)
        const visitorResult = parseVisitorHTML(visitorHtml)
        newCustomerMap = visitorResult.daily
        upsertMonthlyVisitors(year, month, store.name, store.bm_code, visitorResult.totals)
        await new Promise((r) => setTimeout(r, 300))
      } catch {
        // visitor page failure is non-fatal
      }

      // User (顧客分析)
      try {
        const userHtml = await fetchAnalysisPage(storeCookies, 'user', startDate, endDate)
        const userResult = parseUserHTML(userHtml)
        if (userResult.totalUsers > 0) {
          upsertMonthlyUsers(year, month, store.name, store.bm_code, userResult.totalUsers, userResult.appMembers)
        }
        await new Promise((r) => setTimeout(r, 300))
      } catch {
        // user page failure is non-fatal
      }

      if (dailyRows.length > 0) {
        recordsStored += upsertStoreDailySales(
          dailyRows.map((r) => ({
            ...r,
            store: store.name,
            bm_code: store.bm_code,
            new_customers: newCustomerMap.get(r.date) ?? 0,
          }))
        )
      }

      // Staff sales
      const staffHtml = await fetchAnalysis(storeCookies, 'stylist', startDate, endDate)
      const staffRows = parseStaffHTML(staffHtml)
      if (staffRows.length > 0) {
        upsertStaffSales(year, month, store.name, store.bm_code, staffRows)
      }

      storesScraped++

      // Polite delay between stores
      await new Promise((r) => setTimeout(r, 400))
    } catch (e) {
      errors.push(`${store.name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  onProgress?.({ phase: 'done', current: STORES.length, total: STORES.length, detail: '完了' })
  return { storesScraped, recordsStored, errors }
}

