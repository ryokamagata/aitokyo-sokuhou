import { NextResponse } from 'next/server'
import { getScrapedDailySales, getMonthlyTotalSales } from '@/lib/db'
import { computeForecast, computeStandardForecast, computeAverageYoYRate } from '@/lib/forecastEngine'
import { computePLForecast, buildActualPL, type PLForecastResult } from '@/lib/plEngine'
import { CUTOFF_HOUR, CUTOFF_MINUTE } from '@/lib/autoScrape'
import { STORES, MAX_REVENUE_PER_SEAT, isClosedStore } from '@/lib/stores'
import type { DailySales } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const TAX_RATE = 0.10
const FISCAL_START_MONTH = 9 // AI TOKYO は 9 月期

function pad(n: number): string { return String(n).padStart(2, '0') }

/**
 * 9月期 12ヶ月分の PL を一括取得する
 *   - 過去月: cost_actuals_monthly から実績ベースで構築（buildActualPL）
 *   - 当月  : ダッシュボードの売上着地予測 ÷ 1.10（税抜）+ コスト予測
 *   - 将来月: 過去3ヶ月の平均売上（税抜）を用いた予測
 *
 * GET /api/pl-fiscal-year?year=YYYY  (fiscal start year, 例: 2025 = 2025年9月〜2026年8月期)
 *   year を省略すると現在の会計年度を返す
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const tokyoNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
  const curY = tokyoNow.getFullYear()
  const curM = tokyoNow.getMonth() + 1
  const calendarToday = tokyoNow.getDate()
  const hour = tokyoNow.getHours()
  const minute = tokyoNow.getMinutes()
  const today = (hour > CUTOFF_HOUR || (hour === CUTOFF_HOUR && minute >= CUTOFF_MINUTE)) ? calendarToday : calendarToday - 1
  const todayIsoDate = `${curY}-${pad(curM)}-${pad(calendarToday)}`

  const defaultFiscalStartYear = curM >= FISCAL_START_MONTH ? curY : curY - 1
  const fiscalStartYear = parseInt(url.searchParams.get('year') ?? String(defaultFiscalStartYear), 10)

  // 12ヶ月のリスト（9月から翌年8月）
  const monthSlots: { year: number; month: number; isPast: boolean; isCurrent: boolean; isFuture: boolean }[] = []
  for (let i = 0; i < 12; i++) {
    const m0 = (FISCAL_START_MONTH - 1 + i) % 12
    const month = m0 + 1
    const year = fiscalStartYear + (i + FISCAL_START_MONTH > 12 ? 1 : 0)
    const ord = year * 12 + month
    const curOrd = curY * 12 + curM
    monthSlots.push({
      year, month,
      isPast: ord < curOrd,
      isCurrent: ord === curOrd,
      isFuture: ord > curOrd,
    })
  }

  // 当月の売上着地予測（税抜）を1度だけ計算（既存ロジックと同じ）
  let currentRevenueExcl = 0
  let currentRevenueIncl = 0
  let currentSalesConfidence: 'low' | 'medium' | 'high' = 'low'
  {
    const cutoffDate = `${curY}-${pad(curM)}-${String(Math.max(today, 0)).padStart(2, '0')}`
    const scraped = getScrapedDailySales(curY, curM)
    const dailySales: DailySales[] = scraped
      .filter(r => today > 0 && r.date <= cutoffDate)
      .map(r => ({
        date: r.date,
        dayOfWeek: new Date(r.date + 'T00:00:00').getDay(),
        totalAmount: r.sales,
        customers: r.customers,
        newCustomers: r.new_customers,
        stores: {},
        staff: {},
      }))
    const fc = computeForecast(dailySales, curY, curM, today)
    currentSalesConfidence = fc.confidence
    const prevYearMonthly = getMonthlyTotalSales(curY - 1, curM, curY - 1, curM)
    const prevYearSales = prevYearMonthly.length > 0 ? prevYearMonthly[0].sales : null
    const currentYearMonthly = curM > 1 ? getMonthlyTotalSales(curY, 1, curY, curM - 1) : []
    const prevYearAllMonths = curM > 1 ? getMonthlyTotalSales(curY - 1, 1, curY - 1, 12) : []
    const avgYoYRate = computeAverageYoYRate(curY, curM, currentYearMonthly, prevYearAllMonths)
    const totalRevenueCap = STORES
      .filter(s => !isClosedStore(s.name))
      .reduce((sum, s) => sum + s.seats * MAX_REVENUE_PER_SEAT, 0)
    const std = computeStandardForecast(fc, prevYearSales, avgYoYRate, totalRevenueCap)
    currentRevenueIncl = std.standard
    currentRevenueExcl = Math.round(std.standard / (1 + TAX_RATE))
  }

  // 将来月予測のための税抜ベース売上（直近3ヶ月の cost_actuals_monthly 売上平均）
  // 将来月の売上が無い場合は当月予測を使う
  const recentPastForFuture: number[] = []
  for (const slot of monthSlots) {
    if (!slot.isPast) continue
    const pl = buildActualPL(slot.year, slot.month)
    if (pl.revenue > 0) recentPastForFuture.push(pl.revenue)
  }
  const last3Avg = recentPastForFuture.length > 0
    ? Math.round(recentPastForFuture.slice(-3).reduce((s, v) => s + v, 0) / Math.min(3, recentPastForFuture.length))
    : currentRevenueExcl

  type MonthEntry = {
    year: number
    month: number
    isPast: boolean
    isCurrent: boolean
    isFuture: boolean
    revenueIncl: number       // 税込
    revenueExcl: number       // 税抜（PL計算ベース）
    cogs: number
    sga: number
    grossProfit: number
    operatingProfit: number
    opMargin: number
    source: 'pl_actual' | 'sales_forecast' | 'trend_forecast'
    confidence: PLForecastResult['confidence']
  }

  const months: MonthEntry[] = monthSlots.map(slot => {
    let pl: PLForecastResult
    let revenueExcl: number
    let source: MonthEntry['source']

    if (slot.isPast) {
      pl = buildActualPL(slot.year, slot.month)
      revenueExcl = pl.revenue
      source = 'pl_actual'
    } else if (slot.isCurrent) {
      revenueExcl = currentRevenueExcl
      pl = computePLForecast({
        year: slot.year, month: slot.month,
        todayIsoDate,
        revenue: revenueExcl,
        salesConfidence: currentSalesConfidence,
      })
      source = 'sales_forecast'
    } else {
      // 将来月: 直近3ヶ月平均（税抜）で予測
      revenueExcl = last3Avg
      pl = computePLForecast({
        year: slot.year, month: slot.month,
        todayIsoDate,
        revenue: revenueExcl,
        salesConfidence: 'low',
      })
      source = 'trend_forecast'
    }

    const revenueIncl = Math.round(revenueExcl * (1 + TAX_RATE))

    return {
      year: slot.year, month: slot.month,
      isPast: slot.isPast, isCurrent: slot.isCurrent, isFuture: slot.isFuture,
      revenueIncl, revenueExcl,
      cogs: pl.cogs, sga: pl.sga,
      grossProfit: pl.grossProfit, operatingProfit: pl.operatingProfit, opMargin: pl.opMargin,
      source,
      confidence: pl.confidence,
    }
  })

  // 通期合計
  const totals = months.reduce((acc, m) => ({
    revenueIncl: acc.revenueIncl + m.revenueIncl,
    revenueExcl: acc.revenueExcl + m.revenueExcl,
    cogs: acc.cogs + m.cogs,
    sga: acc.sga + m.sga,
    grossProfit: acc.grossProfit + m.grossProfit,
    operatingProfit: acc.operatingProfit + m.operatingProfit,
  }), { revenueIncl: 0, revenueExcl: 0, cogs: 0, sga: 0, grossProfit: 0, operatingProfit: 0 })

  const totalsOpMargin = totals.revenueExcl > 0 ? totals.operatingProfit / totals.revenueExcl : 0

  return NextResponse.json({
    fiscalStartYear,
    fiscalLabel: `${fiscalStartYear}年9月〜${fiscalStartYear + 1}年8月期`,
    taxRate: TAX_RATE,
    months,
    totals: { ...totals, opMargin: totalsOpMargin },
  })
}
