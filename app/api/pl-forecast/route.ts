import { NextResponse } from 'next/server'
import { getScrapedDailySales, getTarget, getRecentCostActuals, savePLSnapshot, getCostAccounts } from '@/lib/db'
import { computeForecast } from '@/lib/forecastEngine'
import { computePLForecast, buildActualPL } from '@/lib/plEngine'
import { CUTOFF_HOUR, CUTOFF_MINUTE } from '@/lib/autoScrape'
import type { DailySales } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function pad(n: number): string { return String(n).padStart(2, '0') }

/**
 * GET /api/pl-forecast?year=YYYY&month=M&save=1
 *   year/month を省略すると当月
 *   save=1 の場合 pl_forecast_snapshots に記録
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const qYear = url.searchParams.get('year')
  const qMonth = url.searchParams.get('month')
  const save = url.searchParams.get('save') === '1'

  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
  const nowYear = now.getFullYear()
  const nowMonth = now.getMonth() + 1
  const calendarToday = now.getDate()
  const hour = now.getHours()
  const minute = now.getMinutes()
  const today = (hour > CUTOFF_HOUR || (hour === CUTOFF_HOUR && minute >= CUTOFF_MINUTE)) ? calendarToday : calendarToday - 1
  const todayIsoDate = `${nowYear}-${pad(nowMonth)}-${pad(calendarToday)}`

  const year = qYear ? parseInt(qYear, 10) : nowYear
  const month = qMonth ? parseInt(qMonth, 10) : nowMonth

  // 過去月: 確定PL取込済みなら実績ベースで返す（lines は 0 が多くてもOK）
  const isPastMonth = (year * 12 + month) < (nowYear * 12 + nowMonth)

  let revenueHint = 0
  let salesConfidence: 'low' | 'medium' | 'high' = 'low'
  if (!isPastMonth) {
    const scraped = getScrapedDailySales(year, month)
    const dailySales: DailySales[] = scraped.map(r => ({
      date: r.date,
      dayOfWeek: new Date(r.date + 'T00:00:00').getDay(),
      totalAmount: r.sales,
      customers: r.customers,
      newCustomers: r.new_customers,
      stores: {},
      staff: {},
    }))
    const fc = computeForecast(dailySales, year, month, today)
    revenueHint = fc.forecastTotal
    salesConfidence = fc.confidence
  }

  const forecast = isPastMonth
    ? buildActualPL(year, month)
    : computePLForecast({ year, month, todayIsoDate, revenue: revenueHint, salesConfidence })

  // 過去6ヶ月分の確定PL推移（cogs + sga のみ、non_op は除外）
  const trendStart = normalizeYM(year, month - 6)
  const trendActuals = getRecentCostActuals(trendStart.year, trendStart.month, year, month)
  const accounts = getCostAccounts()
  const categoryByCode = new Map(accounts.map(a => [a.code, a.category]))
  const trendByMonth = new Map<string, { revenue: number; cost: number }>()
  for (const a of trendActuals) {
    if (a.store !== null) continue
    const cat = categoryByCode.get(a.account_code)
    const key = `${a.year}-${pad(a.month)}`
    if (!trendByMonth.has(key)) trendByMonth.set(key, { revenue: 0, cost: 0 })
    const bucket = trendByMonth.get(key)!
    if (cat === 'revenue') bucket.revenue += a.amount
    else if (cat === 'cogs' || cat === 'sga') bucket.cost += a.amount
  }
  const trend = [...trendByMonth.entries()]
    .map(([ym, v]) => {
      const op = v.revenue - v.cost
      return {
        ym,
        revenue: v.revenue,
        opProfit: op,
        opMargin: v.revenue > 0 ? op / v.revenue : 0,
      }
    })
    .sort((a, b) => a.ym.localeCompare(b.ym))

  if (save) {
    savePLSnapshot({
      year, month, stage: forecast.stage,
      revenue: forecast.revenue, cogs: forecast.cogs,
      personnel: forecast.cogsPersonnel + forecast.sgaPersonnel,
      rent: forecast.sgaRent,
      other_sga: forecast.sga - forecast.sgaRent - forecast.sgaPersonnel,
      operating_profit: forecast.operatingProfit,
      op_margin: forecast.opMargin,
    })
  }

  // KPI target: 営業利益率 5%
  const opMarginTargetPct = 5
  const opMarginPct = forecast.opMargin * 100

  return NextResponse.json({
    year, month,
    todayIsoDate,
    forecast,
    trend,
    kpi: {
      opMarginTargetPct,
      opMarginPct: Math.round(opMarginPct * 100) / 100,
      diffPct: Math.round((opMarginPct - opMarginTargetPct) * 100) / 100,
      passed: opMarginPct >= opMarginTargetPct,
    },
    monthlyTarget: getTarget(year, month),
  })
}

function normalizeYM(year: number, month: number) {
  let y = year, m = month
  while (m <= 0) { y -= 1; m += 12 }
  while (m > 12) { y += 1; m -= 12 }
  return { year: y, month: m }
}
