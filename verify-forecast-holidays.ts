// 定休日反映後の売上予測ロジック検証
// Usage: npx tsx verify-forecast-holidays.ts
//
// 検証内容:
//   1. 2026年4月の定休日判定（東京: 第2/第4月曜 = 4/13, 4/27）
//   2. computeForecast の dailyProjections で定休日が closed:true / projected:0 になるか
//   3. weekday/weekend/regularHoliday の月内日数集計
//   4. 月次レポートのペース予測（定休日を分母から除外）の数値比較
//
// 鎌形さん指示の方針:
//   - 過去実績は定休日でもそのまま集計に含める（除外しない）
//   - 未来予測の定休日は projected = 0
//   - レポートの日割り母数（営業日数）には定休日を含めない

import {
  isRegularHoliday,
  getRegularHolidaysForMonth,
} from './lib/holidays'
import { computeForecast } from './lib/forecastEngine'
import type { DailySales } from './lib/types'

const YEAR = 2026
const MONTH = 4
const DAYS_IN_MONTH = new Date(YEAR, MONTH, 0).getDate()
const pad = (n: number) => String(n).padStart(2, '0')
const dateOf = (d: number) => `${YEAR}-${pad(MONTH)}-${pad(d)}`
const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土']

console.log(`\n=== ${YEAR}年${MONTH}月 定休日反映 検証 ===\n`)

// ── 1. 定休日判定 ───────────────────────────────────
console.log('【1】定休日判定（東京・繁忙期外の第2/第4月曜）')
const detected = getRegularHolidaysForMonth(YEAR, MONTH)
console.log(`  検出: ${detected.join(', ')}`)
console.log(`  期待: 2026-04-13（第2月曜）, 2026-04-27（第4月曜）`)
console.log()

// 1ヶ月のカレンダー全日に対して isRegularHoliday を表示
console.log('【2】4月カレンダー（C=定休日）')
let line = '  '
for (let d = 1; d <= DAYS_IN_MONTH; d++) {
  const date = dateOf(d)
  const dow = new Date(YEAR, MONTH - 1, d).getDay()
  const closed = isRegularHoliday(date)
  line += `${pad(d)}${DOW_LABELS[dow]}${closed ? 'C' : ' '} `
  if (d % 7 === 0) { console.log(line); line = '  ' }
}
if (line.trim()) console.log(line)
console.log()

// ── 3. 繁忙期チェック ────────────────────────────────
console.log('【3】繁忙期判定（3/7/12月は定休日なしのはず）')
for (const m of [3, 7, 12]) {
  const list = getRegularHolidaysForMonth(YEAR, m)
  console.log(`  ${YEAR}/${m}: ${list.length === 0 ? 'OK（定休日なし）' : `NG（${list.join(', ')}）`}`)
}
for (const m of [1, 2, 4, 5, 6, 8, 9, 10, 11]) {
  const list = getRegularHolidaysForMonth(YEAR, m)
  console.log(`  ${YEAR}/${m}: ${list.length === 2 ? 'OK' : 'NG'} → ${list.join(', ')}`)
}
console.log()

// ── 4. computeForecast 検証（サンプル売上で予測ロジック確認） ──
console.log('【4】computeForecast: 月初〜10日まで実績がある想定')
console.log('     （定休日 4/13, 4/27 が未来側で projected=0 になることを確認）\n')

// サンプル: 4/1〜4/10 を実績として投入。1〜10には定休日なし。
//          平日は60万、土日祝は95万を想定。
const sample: DailySales[] = []
for (let d = 1; d <= 10; d++) {
  const date = dateOf(d)
  const dow = new Date(YEAR, MONTH - 1, d).getDay()
  const isWeekend = dow === 0 || dow === 6
  const amount = isWeekend ? 950000 : 600000
  sample.push({
    date,
    dayOfWeek: dow,
    totalAmount: amount,
    customers: Math.round(amount / 8000),
    stores: {},
    staff: {},
  })
}

const result = computeForecast(sample, YEAR, MONTH, 10)

console.log(`  weekdayAverage      : ¥${result.weekdayAverage.toLocaleString()}`)
console.log(`  weekendAverage      : ¥${result.weekendAverage.toLocaleString()}`)
console.log(`  weekdayCount        : ${result.weekdayCount}日`)
console.log(`  weekendCount        : ${result.weekendCount}日`)
console.log(`  regularHolidayCount : ${result.regularHolidayCount}日 ★新規`)
console.log(`  weekday + weekend + regularHoliday = ${
  result.weekdayCount + result.weekendCount + result.regularHolidayCount
} (= ${DAYS_IN_MONTH}日のはず)`)
console.log()
console.log(`  actualTotal         : ¥${result.actualTotal.toLocaleString()}`)
console.log(`  projectedTotal      : ¥${result.projectedTotal.toLocaleString()}`)
console.log(`  forecastTotal       : ¥${result.forecastTotal.toLocaleString()}`)
console.log()

// 定休日の projection 抽出
const closedProjections = result.dailyProjections.filter(p => p.closed)
console.log(`  定休日の projection（${closedProjections.length}件）:`)
for (const p of closedProjections) {
  console.log(`    ${p.date}  projected=${p.projected}  closed=${p.closed}`)
}
console.log()

// 定休日でない11日以降の最初の数件
const futureNonClosed = result.dailyProjections.filter(p => !p.closed).slice(0, 5)
console.log(`  通常日 projection（先頭5件）:`)
for (const p of futureNonClosed) {
  const dow = new Date(p.date + 'T00:00:00').getDay()
  console.log(`    ${p.date} (${DOW_LABELS[dow]})  projected=¥${p.projected.toLocaleString()}`)
}
console.log()

// ── 5. レポート route の営業日ベース計算を再現 ──────────
console.log('【5】月次レポート: ペース予測の比較（修正前 vs 修正後）')
console.log('     条件: 4月 / 経過10日（4/10時点）/ 実績合計を上記と同一に\n')

const currentSales = sample.reduce((s, x) => s + x.totalAmount, 0)
const todayDay = 10

// 修正前ロジック（純粋日割り）
const oldDailyAvg = Math.round(currentSales / todayDay)
const oldPaceEstimate = Math.round(oldDailyAvg * DAYS_IN_MONTH)

// 修正後ロジック（営業日ベース）
let businessDaysElapsed = 0
let businessDaysRemaining = 0
for (let d = 1; d <= DAYS_IN_MONTH; d++) {
  const date = dateOf(d)
  if (isRegularHoliday(date)) continue
  if (d <= todayDay) businessDaysElapsed++
  else businessDaysRemaining++
}
const newDailyAvg = Math.round(currentSales / businessDaysElapsed)
const newPaceEstimate = currentSales + Math.round(newDailyAvg * businessDaysRemaining)

console.log('  ＜修正前＞')
console.log(`    dailyAvg = ${currentSales.toLocaleString()} / ${todayDay} = ¥${oldDailyAvg.toLocaleString()}`)
console.log(`    paceEstimate = ¥${oldDailyAvg.toLocaleString()} × ${DAYS_IN_MONTH} = ¥${oldPaceEstimate.toLocaleString()}`)
console.log()
console.log('  ＜修正後＞')
console.log(`    businessDaysElapsed   = ${businessDaysElapsed}日`)
console.log(`    businessDaysRemaining = ${businessDaysRemaining}日`)
console.log(`    dailyAvg = ${currentSales.toLocaleString()} / ${businessDaysElapsed} = ¥${newDailyAvg.toLocaleString()}`)
console.log(`    paceEstimate = ${currentSales.toLocaleString()} + ¥${newDailyAvg.toLocaleString()} × ${businessDaysRemaining} = ¥${newPaceEstimate.toLocaleString()}`)
console.log()
console.log(`  差分: ¥${(newPaceEstimate - oldPaceEstimate).toLocaleString()} (${
  ((newPaceEstimate - oldPaceEstimate) / oldPaceEstimate * 100).toFixed(2)
}%)`)
console.log()
console.log('  ※ 経過分は同じ実績だが、修正後は「未来の定休日に売上を積まない」ため')
console.log('    純粋日割りより控えめに着地する（=実態に近い）')
console.log()
console.log('=== 検証完了 ===\n')
