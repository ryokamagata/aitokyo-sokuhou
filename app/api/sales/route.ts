import { NextResponse } from 'next/server'
import {
  getScrapedDailySales,
  getScrapedStoreSales,
  getScrapedStaffSales,
  getSalesForMonth,
  getTarget,
  getLastScrapeTime,
} from '@/lib/db'
import { computeForecast } from '@/lib/forecastEngine'
import type { DailySales, DashboardData } from '@/lib/types'

export const revalidate = 0

export async function GET() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const today = now.getDate()
  const daysInMonth = new Date(year, month, 0).getDate()

  const monthlyTarget = getTarget(year, month)

  // ── データソース選択: スクレイピング優先 → CSV フォールバック ──────────────
  let dailySales: DailySales[]
  let storeBreakdown: { store: string; sales: number }[]
  let staffBreakdown: { staff: string; sales: number }[]

  const scrapedDaily = getScrapedDailySales(year, month)

  if (scrapedDaily.length > 0) {
    dailySales = scrapedDaily.map((r) => ({
      date: r.date,
      dayOfWeek: new Date(r.date + 'T00:00:00').getDay(),
      totalAmount: r.sales,
      customers: r.customers,
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
  }

  return NextResponse.json(response)
}
