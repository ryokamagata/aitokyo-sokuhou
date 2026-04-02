import { NextResponse } from 'next/server'
import {
  getScrapedDailySales,
  getScrapedStoreSales,
  getScrapedStaffSales,
  getSalesForMonth,
  getTarget,
  getLastScrapeTime,
  getPerStoreVisitors,
  getPerStoreUsers,
  getPerStoreCycle,
  getMonthlyTotalSales,
} from '@/lib/db'
import { computeForecast } from '@/lib/forecastEngine'
import { mergeStaffSales } from '@/lib/staffNormalize'
import type { DailySales, DashboardData, ForecastDetail } from '@/lib/types'

export const revalidate = 0

export async function GET() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const calendarToday = now.getDate()
  const hour = now.getHours()
  // 22時締め: 22時を過ぎるまでは前日までのデータを使う
  const today = hour >= 22 ? calendarToday : calendarToday - 1
  const daysInMonth = new Date(year, month, 0).getDate()

  const monthlyTarget = getTarget(year, month)

  // ── データソース選択: スクレイピング優先 → CSV フォールバック ──────────────
  let dailySales: DailySales[]
  let storeBreakdown: { store: string; sales: number }[]
  let staffBreakdown: { staff: string; sales: number }[]

  // 22時締め: today日目までのデータのみ使用
  const cutoffDate = `${year}-${String(month).padStart(2, '0')}-${String(Math.max(today, 0)).padStart(2, '0')}`

  const scrapedDaily = getScrapedDailySales(year, month)

  if (scrapedDaily.length > 0) {
    dailySales = scrapedDaily
      .filter((r) => today > 0 && r.date <= cutoffDate)
      .map((r) => ({
        date: r.date,
        dayOfWeek: new Date(r.date + 'T00:00:00').getDay(),
        totalAmount: r.sales,
        customers: r.customers,
        newCustomers: r.new_customers,
        stores: {},
        staff: {},
      }))
    storeBreakdown = getScrapedStoreSales(year, month)
    staffBreakdown = mergeStaffSales(getScrapedStaffSales(year, month))
  } else {
    // CSV フォールバック
    const rawRows = getSalesForMonth(year, month)
    const dayMap: Record<string, DailySales> = {}
    for (const r of rawRows) {
      if (!dayMap[r.date]) {
        dayMap[r.date] = {
          date: r.date,
          dayOfWeek: new Date(r.date + 'T00:00:00').getDay(),
          totalAmount: 0,
          customers: 0,
          stores: {},
          staff: {},
        }
      }
      const d = dayMap[r.date]
      d.totalAmount += r.amount
      d.customers += r.customers
      d.stores[r.store] = (d.stores[r.store] ?? 0) + r.amount
      d.staff[r.staff] = (d.staff[r.staff] ?? 0) + r.amount
    }
    dailySales = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date))

    const storeMap: Record<string, number> = {}
    const staffMap: Record<string, number> = {}
    for (const d of dailySales) {
      for (const [k, v] of Object.entries(d.stores)) storeMap[k] = (storeMap[k] ?? 0) + v
      for (const [k, v] of Object.entries(d.staff)) staffMap[k] = (staffMap[k] ?? 0) + v
    }
    storeBreakdown = Object.entries(storeMap)
      .map(([store, sales]) => ({ store, sales }))
      .sort((a, b) => b.sales - a.sales)
    staffBreakdown = Object.entries(staffMap)
      .filter(([staff]) => staff !== '不明')
      .map(([staff, sales]) => ({ staff, sales }))
      .sort((a, b) => b.sales - a.sales)
  }

  // 日別推移（累積）
  let running = 0
  const dailyData = dailySales.map((d) => {
    running += d.totalAmount
    return { date: d.date.slice(5), sales: d.totalAmount, cumulative: running }
  })

  const forecast = computeForecast(dailySales, year, month, today)
  const achievementRate = monthlyTarget
    ? Math.round((forecast.actualTotal / monthlyTarget) * 100)
    : null

  // ── 顧客KPI ─────────────────────────────────────────────────────────────
  const effectiveDays = Math.max(today, 1)

  // 来店客分析データ (visitor) - 全店舗の個別データ取得
  const visitorStores = getPerStoreVisitors(year, month)

  // 合計値（人数は全店舗合計）
  const nominated = visitorStores.reduce((s, v) => s + v.nominated, 0)
  const freeVisit = visitorStores.reduce((s, v) => s + v.free_visit, 0)
  const newCustomers = visitorStores.reduce((s, v) => s + v.new_customers, 0)

  // 合計総客数 = 来店客分析の指名+フリーを全店舗合計
  const totalCustomers = nominated + freeVisit

  // 今月客単価 = 総売上 ÷ 総客数
  const avgSpend = totalCustomers > 0 ? Math.round(forecast.actualTotal / totalCustomers) : 0

  // 着地予測（日割り × 月日数）
  const newCustomerForecast = Math.round((newCustomers / effectiveDays) * daysInMonth)
  const customerForecast = Math.round((totalCustomers / effectiveDays) * daysInMonth)
  const nominatedForecast = Math.round((nominated / effectiveDays) * daysInMonth)
  const freeVisitForecast = Math.round((freeVisit / effectiveDays) * daysInMonth)

  // 指名率 = 各店舗の (指名 / (指名+フリー)) の平均
  const nominationRates = visitorStores
    .filter(v => (v.nominated + v.free_visit) > 0)
    .map(v => (v.nominated / (v.nominated + v.free_visit)) * 100)
  const nominationRate = nominationRates.length > 0
    ? (nominationRates.reduce((s, r) => s + r, 0) / nominationRates.length).toFixed(1)
    : '0'

  // フリー率 = 100% - 指名率（指名率+フリー率=100%）
  const freeRate = nominationRates.length > 0
    ? (100 - parseFloat(nominationRate)).toFixed(1)
    : '0'

  // 新規率 = 新規人数 / 総客数（実際の新規客比率）
  const newCustomerRate = totalCustomers > 0
    ? ((newCustomers / totalCustomers) * 100).toFixed(1)
    : '0'

  // リピート分析データ - 新規3ヶ月リターン率（各店舗から取得して平均）
  const cycleStores = getPerStoreCycle(year, month)
  const return3mRates = cycleStores
    .filter(c => c.new_return_3m > 0)
    .map(c => c.new_return_3m)
  const newReturn3mRate = return3mRates.length > 0
    ? (return3mRates.reduce((s, r) => s + r, 0) / return3mRates.length).toFixed(1)
    : '—'

  // 顧客データ (user) - 全店舗合計
  const userStores = getPerStoreUsers(year, month)
  const totalUsers = userStores.reduce((s, u) => s + u.total_users, 0)
  const appMembers = userStores.reduce((s, u) => s + u.app_members, 0)

  // アプリ会員率 = 各店舗の (アプリ会員/総顧客) の平均
  const appMemberRates = userStores
    .filter(u => u.total_users > 0)
    .map(u => (u.app_members / u.total_users) * 100)
  const appMemberRate = appMemberRates.length > 0
    ? (appMemberRates.reduce((s, r) => s + r, 0) / appMemberRates.length).toFixed(1)
    : '0'

  // ── 着地予測詳細（3パターン + 根拠）──────────────────────────────────────
  let forecastDetail: ForecastDetail | null = null
  {
    const effectiveDaysForForecast = Math.max(today, 1)
    const dailyAvg = effectiveDaysForForecast > 0 ? forecast.actualTotal / effectiveDaysForForecast : 0
    const monthProgressRate = effectiveDaysForForecast / daysInMonth
    // 日割りペース着地（DOW曜日別は月初に不安定なので単純日割り）
    const simplePaceEstimate = Math.round(dailyAvg * daysInMonth)

    // 前年同月データ取得
    const prevYearMonthly = getMonthlyTotalSales(year - 1, month, year - 1, month)
    const prevYearSales = prevYearMonthly.length > 0 ? prevYearMonthly[0].sales : null

    // 完了月の前年比を計算（今年1月〜先月 vs 去年同月）
    let avgYoYRate: number | null = null
    if (month > 1) {
      const currentYearMonthly = getMonthlyTotalSales(year, 1, year, month - 1)
      const prevYearAllMonths = getMonthlyTotalSales(year - 1, 1, year - 1, 12)

      const yoyRates: number[] = []
      for (let mo = 1; mo < month; mo++) {
        const currKey = `${year}-${String(mo).padStart(2, '0')}`
        const prevKey = `${year - 1}-${String(mo).padStart(2, '0')}`
        const curr = currentYearMonthly.find(m => m.month === currKey)
        const prev = prevYearAllMonths.find(m => m.month === prevKey)
        if (curr && prev && prev.sales > 0) {
          yoyRates.push((curr.sales - prev.sales) / prev.sales)
        }
      }
      if (yoyRates.length > 0) {
        avgYoYRate = yoyRates.reduce((a, b) => a + b, 0) / yoyRates.length
      }
    }

    // YoY予測（前年同月 × (1 + 平均成長率)）
    let yoyEstimate: number | null = null
    if (prevYearSales !== null && prevYearSales > 0) {
      yoyEstimate = avgYoYRate !== null
        ? Math.round(prevYearSales * (1 + avgYoYRate))
        : prevYearSales
    }

    // ブレンド比率（月が進むほどペースを信頼）
    let paceWeight: number
    if (monthProgressRate < 0.3) {
      paceWeight = 0.2
    } else if (monthProgressRate > 0.7) {
      paceWeight = 0.8
    } else {
      paceWeight = 0.2 + (monthProgressRate - 0.3) / 0.4 * 0.6
    }

    // 標準予測（日割りペース × YoY のブレンド）
    let standard: number
    if (yoyEstimate !== null && yoyEstimate > 0) {
      standard = Math.round(simplePaceEstimate * paceWeight + yoyEstimate * (1 - paceWeight))
    } else {
      standard = simplePaceEstimate
    }

    // 堅実予測 = 標準の95%（安定した予測幅）
    const conservative = Math.round(standard * 0.95)

    // 高め見込み = max(ペース着地, YoY着地) の103%、または標準の105%
    let optimistic: number
    if (yoyEstimate !== null && yoyEstimate > 0) {
      optimistic = Math.round(Math.max(simplePaceEstimate, yoyEstimate) * 1.03)
    } else {
      optimistic = Math.round(standard * 1.05)
    }

    forecastDetail = {
      standard,
      conservative,
      optimistic,
      rationale: {
        paceEstimate: simplePaceEstimate,
        yoyEstimate,
        prevYearSales,
        yoyGrowthRate: avgYoYRate !== null ? avgYoYRate * 100 : null,
        paceWeight,
        dailyAvg: Math.round(dailyAvg),
        monthProgress: monthProgressRate,
      },
    }
  }

  const response: DashboardData = {
    year,
    month,
    today,
    daysInMonth,
    totalSales: forecast.actualTotal,
    monthlyTarget,
    achievementRate,
    forecast,
    storeBreakdown,
    staffBreakdown,
    dailyData,
    lastUpdated: getLastScrapeTime() ?? new Date().toISOString(),
    totalCustomers,
    customerForecast,
    avgSpend,
    newCustomers,
    newCustomerForecast,
    nominated,
    nominatedForecast,
    freeVisit,
    freeVisitForecast,
    nominationRate,
    freeRate,
    newCustomerRate,
    newReturn3mRate,
    totalUsers,
    appMembers,
    appMemberRate,
    forecastDetail,
  }

  return NextResponse.json(response)
}
