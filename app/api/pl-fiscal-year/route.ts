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

function pad(n: number): string { return String(n).padStart(2, '0') }

/**
 * 12ヶ月分の PL を一括取得する。
 *   - 過去月: cost_actuals_monthly から実績ベースで構築（buildActualPL）
 *   - 当月  : ダッシュボードの売上着地予測 ÷ 1.10（税抜）+ コスト予測
 *   - 将来月: 前年同月 × YoY 成長率 で売上を予測 + コスト予測
 *
 * GET /api/pl-fiscal-year
 *   ?year=YYYY        対象年（カレンダー年。省略時は今年）
 *   ?startMonth=N     開始月。省略時は 1（カレンダー年の1月〜12月）
 *                     例: startMonth=9 で「9月期」（9月〜翌年8月）として表示
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

  // デフォルトはカレンダー年（1月〜12月）。
  // 9月期で見たい場合は ?startMonth=9 を付与。
  const startMonth = Math.max(1, Math.min(12, parseInt(url.searchParams.get('startMonth') ?? '1', 10)))
  const targetYear = parseInt(url.searchParams.get('year') ?? (
    startMonth === 1
      ? String(curY)
      : (curM >= startMonth ? String(curY) : String(curY - 1))
  ), 10)

  // 12ヶ月のリスト
  const monthSlots: { year: number; month: number; isPast: boolean; isCurrent: boolean; isFuture: boolean }[] = []
  for (let i = 0; i < 12; i++) {
    const m0 = (startMonth - 1 + i) % 12
    const month = m0 + 1
    const year = targetYear + (i + startMonth > 12 ? 1 : 0)
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

  // 将来月予測の元データ:
  //   1) YoY 成長率: 当年既完了月の vs 前年同月の平均成長率（季節性を一定とした成長補正）
  //   2) 前年同月の税込売上 (daily_sales 由来): seasonality を反映した売上ベース
  //   この2つで「前年同月 × (1 + YoY)」を将来月の売上とする。
  //   前年同月が取れない場合は直近3ヶ月の税抜平均にフォールバック。
  const fyCurrYearMonthly = getMonthlyTotalSales(curY, 1, curY, 12)
  const fyPrevYearMonthly = getMonthlyTotalSales(curY - 1, 1, curY - 1, 12)
  const fyYoYRate = computeAverageYoYRate(curY, curM, fyCurrYearMonthly, fyPrevYearMonthly) ?? 0

  const recentPastExclList: number[] = []
  for (const slot of monthSlots) {
    if (!slot.isPast) continue
    const pl = buildActualPL(slot.year, slot.month)
    if (pl.revenue > 0) recentPastExclList.push(pl.revenue)
  }
  const last3AvgExcl = recentPastExclList.length > 0
    ? Math.round(recentPastExclList.slice(-3).reduce((s, v) => s + v, 0) / Math.min(3, recentPastExclList.length))
    : currentRevenueExcl

  function forecastFutureRevenueExcl(year: number, month: number): number {
    const prev = getMonthlyTotalSales(year - 1, month, year - 1, month)
    if (prev.length > 0 && prev[0].sales > 0) {
      const projectedIncl = Math.round(prev[0].sales * (1 + fyYoYRate))
      return Math.round(projectedIncl / (1 + TAX_RATE))
    }
    return last3AvgExcl
  }

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
      // 過去月の判定:
      //   - cost_actuals_monthly に本物のコストデータがあれば「実績PL」を使う
      //   - daily_sales 由来の売上しか無い場合は computePLForecast で原価/販管費を推定
      //     （buildActualPL だとコスト=0で営業利益=売上 となり実態とかけ離れるため）
      const candidate = buildActualPL(slot.year, slot.month)
      // コスト科目に5件以上の実績がある月のみ「PL取込済み」とみなす
      const hasRealCosts = candidate.coverage.actualCosts >= 5
      if (hasRealCosts) {
        pl = candidate
        revenueExcl = pl.revenue
        source = 'pl_actual'
      } else {
        // 売上だけ daily_sales から取れた状態 → コストは予測ロジックで埋める
        revenueExcl = candidate.revenue
        pl = computePLForecast({
          year: slot.year, month: slot.month,
          todayIsoDate,
          revenue: revenueExcl,
          salesConfidence: 'high',
        })
        source = 'sales_forecast' // 「PL未取込・売上だけ実績」状態
      }
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
      // 将来月: 前年同月 × YoY 成長率（季節性を反映）でベース売上を作り、コストは予測ロジック
      revenueExcl = forecastFutureRevenueExcl(slot.year, slot.month)
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

  // 期間ラベル（カレンダー年か任意startMonthか）
  const lastSlot = monthSlots[monthSlots.length - 1]
  const fiscalLabel = startMonth === 1
    ? `${targetYear}年（1月〜12月）`
    : `${targetYear}年${startMonth}月〜${lastSlot.year}年${lastSlot.month}月期`

  return NextResponse.json({
    fiscalStartYear: targetYear,
    startMonth,
    fiscalLabel,
    taxRate: TAX_RATE,
    months,
    totals: { ...totals, opMargin: totalsOpMargin },
    forecastBase: {
      yoyRate: fyYoYRate,                            // 当年既完了月の平均YoY成長率
      method: 'prev_year_same_month_x_yoy',          // 将来月予測ロジック識別子
      fallbackLast3AvgExcl: last3AvgExcl,            // 前年同月が取れない月のフォールバック値
    },
  })
}
