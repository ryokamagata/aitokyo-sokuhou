import type { DailySales, ForecastResult } from './types'
import { getHolidayMap } from './holidays'

export function computeForecast(
  dailySales: DailySales[],
  year: number,
  month: number,
  today: number
): ForecastResult {
  const daysInMonth = new Date(year, month, 0).getDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  const monthStart = `${year}-${pad(month)}-01`
  const monthEnd = `${year}-${pad(month)}-${pad(daysInMonth)}`
  const holidays = getHolidayMap(monthStart, monthEnd)

  const isWeekendOrHoliday = (dateStr: string, dow: number): boolean =>
    dow === 0 || dow === 6 || holidays[dateStr] !== undefined

  // Step 1: 平日 / 土日祝 に分類して実績を集計（ゼロ売上の日は除外）
  const weekdayAmounts: number[] = []
  const weekendAmounts: number[] = []
  for (const day of dailySales) {
    if (day.totalAmount <= 0) continue
    const dow = new Date(day.date + 'T00:00:00').getDay()
    if (isWeekendOrHoliday(day.date, dow)) {
      weekendAmounts.push(day.totalAmount)
    } else {
      weekdayAmounts.push(day.totalAmount)
    }
  }

  const avg = (arr: number[]) =>
    arr.length > 0 ? Math.round(arr.reduce((s, a) => s + a, 0) / arr.length) : 0

  const weekdayAverage = avg(weekdayAmounts)
  const weekendAverage = avg(weekendAmounts)

  // Step 2: 月内の平日/土日祝の総日数
  let weekdayCount = 0
  let weekendCount = 0
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${pad(month)}-${pad(d)}`
    const dow = new Date(year, month - 1, d).getDay()
    if (isWeekendOrHoliday(dateStr, dow)) weekendCount++
    else weekdayCount++
  }

  const weekdayActualDays = weekdayAmounts.length
  const weekendActualDays = weekendAmounts.length

  // Step 3: データなしフォールバック
  if (weekdayAverage === 0 && weekendAverage === 0) {
    return {
      actualTotal: 0,
      projectedTotal: 0,
      forecastTotal: 0,
      confidence: 'low',
      dailyProjections: [],
      weekdayAverage: 0,
      weekendAverage: 0,
      weekdayCount,
      weekendCount,
      weekdayActualDays: 0,
      weekendActualDays: 0,
    }
  }

  // 片側しかデータがない場合は、もう片方にも同じ平均を使ってフォールバック
  const effectiveWeekdayAvg = weekdayAverage > 0 ? weekdayAverage : weekendAverage
  const effectiveWeekendAvg = weekendAverage > 0 ? weekendAverage : weekdayAverage

  // Step 4: 実績に無い日を平日/土日祝の平均で予測
  // today が DB にまだ無くても projection に含まれるので、締日直後のスクレイプで
  // 実績に繰り上がった瞬間に forecastTotal がズレずに差分だけ反映される。
  const actualTotal = dailySales.reduce((s, d) => s + d.totalAmount, 0)
  const actualDateSet = new Set(dailySales.map((d) => d.date))
  const dailyProjections: { date: string; projected: number }[] = []
  let projectedTotal = 0

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${pad(month)}-${pad(d)}`
    if (actualDateSet.has(dateStr)) continue
    const dow = new Date(year, month - 1, d).getDay()
    const projected = isWeekendOrHoliday(dateStr, dow)
      ? effectiveWeekendAvg
      : effectiveWeekdayAvg
    dailyProjections.push({ date: dateStr, projected })
    projectedTotal += projected
  }

  // Step 5: 予測精度
  const actualDays = weekdayActualDays + weekendActualDays
  const confidence: ForecastResult['confidence'] =
    actualDays >= 15 ? 'high' : actualDays >= 7 ? 'medium' : 'low'

  // today は呼び出し側の整合性のため残しているが、v2 の計算では未使用
  void today

  return {
    actualTotal,
    projectedTotal,
    forecastTotal: actualTotal + projectedTotal,
    confidence,
    dailyProjections,
    weekdayAverage,
    weekendAverage,
    weekdayCount,
    weekendCount,
    weekdayActualDays,
    weekendActualDays,
  }
}

/**
 * ダッシュボードの「着地予測」と同じ標準予測値を算出する共有関数。
 * /api/sales と /api/pl-forecast の両方で同一の数字を出すために使う。
 *
 * 入力:
 *   - forecast: computeForecast の結果
 *   - prevYearSales: 前年同月の売上実績（無ければ null）
 *   - avgYoYRate: 当年既完了月の平均YoY成長率（無ければ null。例: 0.05 → +5%）
 *   - totalRevenueCap: 全店舗席数ベースの月間売上上限
 */
export interface StandardForecast {
  standard: number
  conservative: number
  optimistic: number
  paceEstimate: number
  yoyEstimate: number | null
  paceWeight: number
}

// データ十分性のしきい値: 平日5日 + 土日祝2日 が揃ったらペース100%（鎌形さん要望）
const PACE_FULL_WEEKDAY_DAYS = 5
const PACE_FULL_WEEKEND_DAYS = 2

export function computeStandardForecast(
  forecast: ForecastResult,
  prevYearSales: number | null,
  avgYoYRate: number | null,
  totalRevenueCap: number,
  // 第5引数（任意）: 前月実績×季節率で算出した着地予測。
  // 渡されると YoY より優先してブレンド対象に使う。
  prevMonthSeasonalEstimate?: number | null
): StandardForecast {
  const paceEstimate = forecast.forecastTotal

  let yoyEstimate: number | null = null
  if (prevYearSales !== null && prevYearSales > 0) {
    yoyEstimate =
      avgYoYRate !== null
        ? Math.round(prevYearSales * (1 + avgYoYRate))
        : prevYearSales
  }

  // 段階的なペース信頼度:
  //   平日 ≥ 5日 AND 土日祝 ≥ 2日 → 1.0（実測ペース100%）
  //   それ以下は加重平均で連続的に低下（少ないデータでペース予測が暴走するのを防ぐ）
  //   weekday/weekend を必要日数の比率の加重平均（必要日数比で重み付け）
  const wdNeed = PACE_FULL_WEEKEND_DAYS + PACE_FULL_WEEKDAY_DAYS
  const wdRatio = Math.min(forecast.weekdayActualDays / PACE_FULL_WEEKDAY_DAYS, 1.0)
  const weRatio = Math.min(forecast.weekendActualDays / PACE_FULL_WEEKEND_DAYS, 1.0)
  const paceWeight = wdRatio * (PACE_FULL_WEEKDAY_DAYS / wdNeed) + weRatio * (PACE_FULL_WEEKEND_DAYS / wdNeed)

  // ブレンド対象（pace と組み合わせる "もう片方"）:
  //   優先: 前月実績×季節変動率（鎌形さん要望: 前月の流れを汲む方がモチベが上がる）
  //   フォールバック: 前年同月×YoY
  const blendBase: number | null =
    prevMonthSeasonalEstimate !== null && prevMonthSeasonalEstimate !== undefined && prevMonthSeasonalEstimate > 0
      ? prevMonthSeasonalEstimate
      : (yoyEstimate !== null && yoyEstimate > 0 ? yoyEstimate : null)

  let standard: number
  if (blendBase !== null) {
    standard = Math.round(paceEstimate * paceWeight + blendBase * (1 - paceWeight))
  } else {
    standard = paceEstimate
  }
  standard = Math.min(standard, totalRevenueCap)

  const conservative = Math.round(standard * 0.95)

  let optimistic: number
  if (blendBase !== null) {
    optimistic = Math.round(Math.max(paceEstimate, blendBase) * 1.03)
  } else {
    optimistic = Math.round(standard * 1.05)
  }
  optimistic = Math.min(optimistic, totalRevenueCap)

  return { standard, conservative, optimistic, paceEstimate, yoyEstimate, paceWeight }
}

/**
 * 当年既完了月（1月〜先月）の平均YoY成長率を算出。
 * monthlyTotalSales: { month: "YYYY-MM", sales: number } の配列で、
 * 当年と前年の12ヶ月分が入っている前提。
 */
export function computeAverageYoYRate(
  year: number,
  upToMonthExclusive: number,
  currentYearMonthly: { month: string; sales: number }[],
  prevYearMonthly: { month: string; sales: number }[]
): number | null {
  if (upToMonthExclusive <= 1) return null
  const yoyRates: number[] = []
  for (let mo = 1; mo < upToMonthExclusive; mo++) {
    const currKey = `${year}-${String(mo).padStart(2, '0')}`
    const prevKey = `${year - 1}-${String(mo).padStart(2, '0')}`
    const curr = currentYearMonthly.find((m) => m.month === currKey)
    const prev = prevYearMonthly.find((m) => m.month === prevKey)
    if (curr && prev && prev.sales > 0) {
      yoyRates.push((curr.sales - prev.sales) / prev.sales)
    }
  }
  if (yoyRates.length === 0) return null
  return yoyRates.reduce((a, b) => a + b, 0) / yoyRates.length
}
