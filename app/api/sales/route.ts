import { NextResponse } from 'next/server'
import {
  getScrapedDailySales,
  getScrapedStoreSales,
  getScrapedStaffSales,
  getSalesForMonth,
  getTarget,
  getLastScrapeTime,
  getMonthlyVisitors,
  getMonthlyUsers,
} from '@/lib/db'
import { computeForecast } from '@/lib/forecastEngine'
import type { DailySales, DashboardData } from '@/lib/types'

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
    staffBreakdown = getScrapedStaffSales(year, month)
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
  const totalCustomers = dailySales.reduce((s, d) => s + d.customers, 0)
  const avgSpend = totalCustomers > 0 ? Math.round(forecast.actualTotal / totalCustomers) : 0

  // 新規人数 (per-day data for forecast)
  const newCustomers = dailySales.reduce((s, d) => s + (d.newCustomers ?? 0), 0)
  const effectiveDays = Math.max(today, 1)
  const newCustomerForecast = effectiveDays > 0
    ? Math.round((newCustomers / effectiveDays) * daysInMonth)
    : 0

  // 来店客分析データ (visitor)
  const visitors = getMonthlyVisitors(year, month)
  const nominated = visitors?.nominated ?? 0
  const freeVisit = visitors?.free_visit ?? 0
  const visitorTotal = nominated + freeVisit
  const nominationRate = visitorTotal > 0 ? ((nominated / visitorTotal) * 100).toFixed(1) : '0'
  const revisit = visitors?.revisit ?? 0
  const fixed = visitors?.fixed ?? 0
  const reReturn = visitors?.re_return ?? 0
  const repeatTotal = revisit + fixed + reReturn
  const visitorNew = visitors?.new_customers ?? 0
  const repeatRate = (visitorNew + repeatTotal) > 0
    ? ((repeatTotal / (visitorNew + repeatTotal)) * 100).toFixed(1)
    : '0'

  // 顧客データ (user)
  const users = getMonthlyUsers(year, month)
  const totalUsers = users?.total_users ?? 0
  const appMembers = users?.app_members ?? 0
  const appMemberRate = totalUsers > 0 ? ((appMembers / totalUsers) * 100).toFixed(1) : '0'

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
    avgSpend,
    newCustomers,
    newCustomerForecast,
    nominated,
    freeVisit,
    nominationRate,
    repeatRate,
    totalUsers,
    appMembers,
    appMemberRate,
  }

  return NextResponse.json(response)
}
