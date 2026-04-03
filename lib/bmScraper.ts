import * as cheerio from 'cheerio'
import {
  upsertStoreDailySales,
  upsertStaffSales,
  upsertMonthlyVisitors,
  upsertMonthlyUsers,
  upsertMonthlyCycle,
  upsertUtilization,
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

  // POST login - BM returns 302 on success, 200 (login page) on failure
  const res = await fetch(`${BM_BASE}/groupmanage/login/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ login_id: loginId, password }).toString(),
    redirect: 'manual',
  })

  if (res.status !== 302) {
    // Login page returned instead of redirect = credentials rejected
    const html = await res.text()
    const errMatch = html.match(/<div class="error">([^<]+)</)
    const errMsg = errMatch ? errMatch[1] : 'ログインに失敗しました'
    throw new Error(`BM login failed: ${errMsg}`)
  }

  const cookies = cookiesFromResponse(res)
  const loc = res.headers.get('location') ?? `${BM_BASE}/groupmanage/top`
  const nextUrl = loc.startsWith('http') ? loc : `${BM_BASE}${loc}`

  // Follow the redirect to get session cookies
  const { cookies: finalCookies } = await fetchFollowRedirects(nextUrl, {}, cookies)
  if (finalCookies.size === 0) throw new Error('Group login failed: no session cookies')
  return finalCookies
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

  // BM visitor page uses ROW-BASED layout:
  // Table 1: 指名件数|549, フリー件数|58, 指名率|90.4%
  // Table 2: 新規|233, 再来|61, 固定|305, リターン|8, リピート率|60.3%
  // Each row: <td>metricName</td><td>value</td>
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
    if (i === 0) return // skip form table
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

  return { daily, totals }
}

// ─── User (顧客) parsing ─────────────────────────────────────────────────────

function parseUserHTML(html: string): { totalUsers: number; appMembers: number } {
  const $ = cheerio.load(html)
  let totalUsers = 0, appMembers = 0

  // BM user page: <thead> has 日付, (empty), 顧客数, アプリ会員数, アプリ会員率
  // Data rows: <th>date</th><th>曜日</th> then <td>顧客数</td><td>アプリ会員数</td><td>アプリ会員率</td>
  // So <td> cells are: index 0=顧客数, index 1=アプリ会員数
  // Use first data row (latest cumulative count)
  const num = (text: string) => parseInt(text.replace(/[^0-9]/g, '')) || 0

  $('table').each((i, table) => {
    if (i === 0) return // skip form table
    const headers = $(table).find('thead th, thead td').map((__, el) => $(el).text().trim()).get()
    if (!headers.some(h => h.includes('顧客数'))) return

    const rows = $(table).find('tbody tr')
    rows.each((__, tr) => {
      const cells = $(tr).find('td').map((___, td) => $(td).text().trim()).get()
      if (cells.length >= 2) {
        totalUsers = num(cells[0])
        appMembers = num(cells[1])
        return false // use first data row
      }
    })

    if (totalUsers > 0) return false // break
  })

  return { totalUsers, appMembers }
}

// ─── Repeat (リピート分析) parsing ─────────────────────────────────────────────

function parseRepeatHTML(html: string): number {
  const $ = cheerio.load(html)
  let newReturn3m = 0

  const parseNum = (text: string) => parseFloat(text.replace(/[^0-9.]/g, '')) || 0

  // BM リピート分析 table structure (actual):
  //   Row 0: "2025年09月来店" | "再来店月" | "失客"
  //   Row 1: "1ヶ月後(10月)" | "2ヶ月後(11月)" | "3ヶ月後(12月)" | ...
  //   Row 2: "来店区分" | "来店客数" | "構成比" | "客数" | "再来率" | "客数" | "再来率" | ...
  //   Row 3: "新規" | "377" | "41.1%" | "58" | "15.4%" | "51" | "28.9%" | "28" | "36.3%" | ...
  //   Row 4: "再来" | ...
  //   Row 5: "固定" | ...
  //
  // We need: 新規 row × 3ヶ月後 column's 再来率
  // The 3ヶ月後's 再来率 is at a specific column index.
  // Column layout: [来店区分, 来店客数, 構成比, 1m客数, 1m再来率, 2m客数, 2m再来率, 3m客数, 3m再来率, ...]
  // So 3ヶ月後の再来率 = index 8 (0-indexed)

  $('table').each((i, table) => {
    if (i === 0) return // skip form table

    const rows: string[][] = []
    $(table).find('tr').each((_, tr) => {
      const cells = $(tr).find('td, th').map((__, el) => $(el).text().trim()).get()
      rows.push(cells)
    })

    // Look for the header row with month periods to find the 3ヶ月後 column
    let threeMonthRateCol = -1
    for (const row of rows) {
      // Find the row that contains "3ヶ月後" or "3か月後"
      for (let c = 0; c < row.length; c++) {
        if (/3[ヶか]月後/.test(row[c])) {
          // The period headers span 2 data columns each (客数 + 再来率)
          // Count how many period headers come before this one
          let periodCount = 0
          for (let j = 0; j < c; j++) {
            if (/\d+[ヶか]月後/.test(row[j])) periodCount++
          }
          // Column layout: 来店区分(0), 来店客数(1), 構成比(2), then pairs of (客数, 再来率)
          // 1ヶ月後: cols 3,4 | 2ヶ月後: cols 5,6 | 3ヶ月後: cols 7,8
          threeMonthRateCol = 3 + (periodCount * 2) + 1 // +1 for 再来率 (not 客数)
          break
        }
      }
      if (threeMonthRateCol >= 0) break
    }

    // If we couldn't find via headers, use default position (index 8)
    if (threeMonthRateCol < 0) threeMonthRateCol = 8

    // Find the 新規 row and extract the 3ヶ月後 再来率
    for (const row of rows) {
      if (row.length > threeMonthRateCol && row[0] === '新規') {
        newReturn3m = parseNum(row[threeMonthRateCol])
        break
      }
    }

    if (newReturn3m > 0) return false // found it, stop
  })

  return newReturn3m
}

// ─── Utilization rate parsing ────────────────────────────────────────────────

/** BM「データ」ページから稼働率を抽出 */
export function parseUtilizationHTML(html: string): { date: string; rate: number; totalSlots: number; bookedSlots: number }[] {
  const $ = cheerio.load(html)
  const results: { date: string; rate: number; totalSlots: number; bookedSlots: number }[] = []

  // BMのデータページのテーブルから日別の稼働率を抽出
  $('table tbody tr').each((_, tr) => {
    const cells = $(tr).find('td')
    if (cells.length < 2) return

    const dateText = $(cells[0]).text().trim()
    const dateMatch = dateText.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/)
    if (!dateMatch) return
    const date = `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`

    // 稼働率のセルを探す（%表記）
    let rate = 0
    let totalSlots = 0
    let bookedSlots = 0

    cells.each((ci, cell) => {
      const text = $(cell).text().trim()
      const pctMatch = text.match(/([\d.]+)\s*%/)
      if (pctMatch && ci > 0) {
        rate = parseFloat(pctMatch[1])
      }
      // スロット数がある場合（例: "45/60"）
      const slotMatch = text.match(/(\d+)\s*[\/]\s*(\d+)/)
      if (slotMatch) {
        bookedSlots = parseInt(slotMatch[1])
        totalSlots = parseInt(slotMatch[2])
      }
    })

    if (rate > 0 || bookedSlots > 0) {
      results.push({ date, rate, totalSlots, bookedSlots })
    }
  })

  return results
}

/** BMデータページ（稼働率）を取得 */
async function fetchUtilizationPage(
  cookies: Cookies,
  startDate: string,
  endDate: string
): Promise<string> {
  // BMの「データ」→「稼働率」ページ: /manage/analysis/occupancyrate
  const params = buildAnalysisParams(startDate, endDate)
  const url = `${BM_BASE}/manage/analysis/occupancyrate?${params.toString()}`
  const { response } = await fetchFollowRedirects(url, {}, cookies)
  if (!response.ok) throw new Error(`HTTP ${response.status} for occupancyrate`)
  return response.text()
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

      // Repeat (リピート分析) - 新規3ヶ月リターン率
      try {
        const repeatHtml = await fetchAnalysisPage(storeCookies, 'repeat', startDate, endDate)
        const newReturn3m = parseRepeatHTML(repeatHtml)
        if (newReturn3m > 0) {
          upsertMonthlyCycle(year, month, store.name, store.bm_code, 0, newReturn3m)
        }
        await new Promise((r) => setTimeout(r, 300))
      } catch {
        // repeat page failure is non-fatal
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

      // Utilization rate (稼働率)
      try {
        const utilHtml = await fetchUtilizationPage(storeCookies, startDate, endDate)
        const utilRows = parseUtilizationHTML(utilHtml)
        for (const u of utilRows) {
          upsertUtilization(u.date, store.name, store.bm_code, u.rate, u.totalSlots, u.bookedSlots)
        }
        await new Promise((r) => setTimeout(r, 300))
      } catch {
        // utilization page failure is non-fatal
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

