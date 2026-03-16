import * as cheerio from 'cheerio'
import {
  upsertStoreDailySales,
  upsertStaffSales,
  upsertAnalysisData,
} from './db'
import { ANALYSIS_TYPES, type AnalysisType } from './analysisTypes'
import { parseAnalysisHTML } from './analysisParser'
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
      if (dailyRows.length > 0) {
        recordsStored += upsertStoreDailySales(
          dailyRows.map((r) => ({ ...r, store: store.name, bm_code: store.bm_code }))
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

// ─── Analysis page scraping ─────────────────────────────────────────────────

async function fetchAnalysisPage(
  cookies: Cookies,
  type: AnalysisType,
  startDate: string,
  endDate: string
): Promise<string> {
  // BM分析ページは GET フォーム送信
  // 正しいパラメータ名: periodType, startDay, endDay, startYear, startMonth, endYear, endMonth
  const startParts = startDate.split('-')
  const endParts = endDate.split('-')
  const params = new URLSearchParams({
    periodType: '0', // 0=daily
    startDay: startDate,
    endDay: endDate,
    startYear: startParts[0],
    startMonth: String(parseInt(startParts[1])),
    endYear: endParts[0],
    endMonth: String(parseInt(endParts[1])),
    shopUserId: '', // 全スタッフ
  })
  // account ページは追加パラメータあり
  if (type === 'account') {
    params.set('shopUserType', '0')
    params.set('routeId', '')
  }
  const url = `${BM_BASE}/manage/analysis/${type}?${params.toString()}`
  const { response } = await fetchFollowRedirects(url, {}, cookies)
  if (!response.ok) throw new Error(`HTTP ${response.status} for analysis/${type}`)
  return response.text()
}

/** パース結果が空（データなし）かどうかを判定 */
function isEmptyResult(parsed: object): boolean {
  const p = parsed as Record<string, unknown>
  // channels/staff/menus/products/categories/tables/daily 配列が全て空
  for (const key of ['channels', 'staff', 'menus', 'products', 'categories', 'tables', 'daily']) {
    if (Array.isArray(p[key]) && (p[key] as unknown[]).length > 0) return false
  }
  // summary の pureSales/totalCustomers が 0 より大きければデータあり
  if (p.summary && typeof p.summary === 'object') {
    const s = p.summary as Record<string, number>
    if ((s.pureSales || 0) > 0 || (s.totalCustomers || 0) > 0) return false
  }
  // total が 0 より大きければデータあり (reserve)
  if (typeof p.total === 'number' && p.total > 0) return false
  return true
}

export interface AnalysisScrapeResult {
  storesScraped: number
  typesScraped: number
  errors: string[]
}

export async function scrapeAllAnalysis(
  year: number,
  month: number,
  today: number,
  types?: AnalysisType[],
  onProgress?: (p: ScrapeProgress) => void
): Promise<AnalysisScrapeResult> {
  const mm = String(month).padStart(2, '0')
  const dd = String(today).padStart(2, '0')
  const startDate = `${year}-${mm}-01`
  const endDate = `${year}-${mm}-${dd}`
  const targetTypes = types ?? Array.from(ANALYSIS_TYPES)
  const totalPages = STORES.length * targetTypes.length

  onProgress?.({ phase: 'login', current: 0, total: totalPages, detail: 'BMにログイン中...' })
  const groupCookies = await loginGroup()

  let storesScraped = 0
  let typesScraped = 0
  let pagesDone = 0
  const errors: string[] = []

  for (let si = 0; si < STORES.length; si++) {
    const store = STORES[si]
    try {
      const storeCookies = await loginStore(groupCookies, store.bm_code)
      let storeTypesOk = 0

      for (let ti = 0; ti < targetTypes.length; ti++) {
        const type = targetTypes[ti]
        pagesDone++
        onProgress?.({
          phase: 'scraping',
          current: pagesDone,
          total: totalPages,
          storeName: store.name,
          detail: `${store.name} - ${type}`,
        })
        try {
          const html = await fetchAnalysisPage(storeCookies, type, startDate, endDate)
          const parsed = parseAnalysisHTML(type, html)

          // Validate: skip if parsed result is empty
          if (isEmptyResult(parsed)) {
            errors.push(`${store.name}/${type}: パースデータが空です`)
          } else {
            upsertAnalysisData(
              type,
              store.bm_code,
              store.name,
              startDate,
              endDate,
              JSON.stringify(parsed)
            )
            storeTypesOk++
          }

          // 300ms delay between pages
          await new Promise((r) => setTimeout(r, 300))
        } catch (e) {
          errors.push(`${store.name}/${type}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }

      if (storeTypesOk > 0) {
        storesScraped++
        typesScraped += storeTypesOk
      }

      // 500ms delay between stores
      await new Promise((r) => setTimeout(r, 500))
    } catch (e) {
      // Store login failed - skip all types for this store
      pagesDone = (si + 1) * targetTypes.length
      errors.push(`${store.name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  onProgress?.({ phase: 'done', current: totalPages, total: totalPages, detail: '完了' })
  return { storesScraped, typesScraped, errors }
}
