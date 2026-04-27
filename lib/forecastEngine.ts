import type { DailySales, ForecastResult } from './types'
import { getHolidayMap, isRegularHoliday } from './holidays'

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
  // 定休日であっても売上が立っていれば実績は普通に集計する
  // （アシスタント練習等で売上が発生する日があるため、母数には含める）
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

  // Step 2: 月内の平日/土日祝/定休日の総日数
  // 定休日は予測加算しないため、weekday/weekend どちらにもカウントしない
  let weekdayCount = 0
  let weekendCount = 0
  let regularHolidayCount = 0
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${pad(month)}-${pad(d)}`
    if (isRegularHoliday(dateStr)) {
      regularHolidayCount++
      continue
    }
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
      regularHolidayCount,
    }
  }

  // 片側しかデータがない場合は、もう片方にも同じ平均を使ってフォールバック
  const effectiveWeekdayAvg = weekdayAverage > 0 ? weekdayAverage : weekendAverage
  const effectiveWeekendAvg = weekendAverage > 0 ? weekendAverage : weekdayAverage

  // Step 4: 実績に無い日を平日/土日祝の平均で予測
  // 未来の定休日（東京: 繁忙期外の第2/第4月曜）は projected = 0 とする。
  // 定休日に売上が立っている実績は actualTotal にそのまま乗っているので
  // 「実績は実績、未来は閉店扱い」で整合する。
  const actualTotal = dailySales.reduce((s, d) => s + d.totalAmount, 0)
  const actualDateSet = new Set(dailySales.map((d) => d.date))
  const dailyProjections: { date: string; projected: number; closed?: boolean }[] = []
  let projectedTotal = 0

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${pad(month)}-${pad(d)}`
    if (actualDateSet.has(dateStr)) continue
    if (isRegularHoliday(dateStr)) {
      dailyProjections.push({ date: dateStr, projected: 0, closed: true })
      continue
    }
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
    regularHolidayCount,
  }
}
