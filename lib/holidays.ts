// 日本の祝日判定ユーティリティ

type HolidayEntry = { date: string; name: string }

/** 固定祝日 (月-日) */
const FIXED_HOLIDAYS: Record<string, string> = {
  '01-01': '元日',
  '02-11': '建国記念の日',
  '02-23': '天皇誕生日',
  '04-29': '昭和の日',
  '05-03': '憲法記念日',
  '05-04': 'みどりの日',
  '05-05': 'こどもの日',
  '08-11': '山の日',
  '11-03': '文化の日',
  '11-23': '勤労感謝の日',
}

/** ハッピーマンデー: [月, 第N月曜] */
const HAPPY_MONDAYS: [number, number, string][] = [
  [1, 2, '成人の日'],
  [7, 3, '海の日'],
  [9, 3, '敬老の日'],
  [10, 2, 'スポーツの日'],
]

/** 春分の日・秋分の日の概算（天文計算による近似） */
function getEquinox(year: number, type: 'spring' | 'autumn'): number {
  if (type === 'spring') {
    // 3月の春分日
    return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4))
  }
  // 9月の秋分日
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4))
}

/** 第N月曜日の日付を取得 */
function getNthMonday(year: number, month: number, n: number): number {
  const firstDay = new Date(year, month - 1, 1).getDay()
  // 最初の月曜日
  const firstMonday = firstDay <= 1 ? (1 - firstDay + 1) : (8 - firstDay + 1)
  return firstMonday + (n - 1) * 7
}

/** 指定年の祝日一覧を取得 */
export function getHolidaysForYear(year: number): HolidayEntry[] {
  const holidays: HolidayEntry[] = []
  const pad = (n: number) => String(n).padStart(2, '0')

  // 固定祝日
  for (const [md, name] of Object.entries(FIXED_HOLIDAYS)) {
    holidays.push({ date: `${year}-${md}`, name })
  }

  // ハッピーマンデー
  for (const [month, nth, name] of HAPPY_MONDAYS) {
    const day = getNthMonday(year, month, nth)
    holidays.push({ date: `${year}-${pad(month)}-${pad(day)}`, name })
  }

  // 春分の日
  const springDay = getEquinox(year, 'spring')
  holidays.push({ date: `${year}-03-${pad(springDay)}`, name: '春分の日' })

  // 秋分の日
  const autumnDay = getEquinox(year, 'autumn')
  holidays.push({ date: `${year}-09-${pad(autumnDay)}`, name: '秋分の日' })

  // 振替休日: 祝日が日曜の場合、翌月曜日が振替休日
  const holidayDates = new Set(holidays.map(h => h.date))
  const substituteHolidays: HolidayEntry[] = []
  for (const h of holidays) {
    const d = new Date(h.date + 'T00:00:00')
    if (d.getDay() === 0) { // 日曜日
      let next = new Date(d)
      next.setDate(next.getDate() + 1)
      while (holidayDates.has(next.toISOString().slice(0, 10))) {
        next.setDate(next.getDate() + 1)
      }
      const subDate = next.toISOString().slice(0, 10)
      substituteHolidays.push({ date: subDate, name: '振替休日' })
      holidayDates.add(subDate)
    }
  }
  holidays.push(...substituteHolidays)

  // 国民の休日: 前後が祝日の平日（5/4は固定祝日なので主にGW周辺）
  // 簡略化: 特に追加処理不要（みどりの日が5/4に固定されたため）

  return holidays.sort((a, b) => a.date.localeCompare(b.date))
}

/** 指定日が祝日かどうか判定。祝日名を返す（祝日でなければnull） */
export function getHolidayName(dateStr: string): string | null {
  const year = parseInt(dateStr.slice(0, 4))
  const holidays = getHolidaysForYear(year)
  return holidays.find(h => h.date === dateStr)?.name ?? null
}

/** 指定期間の祝日をMapで返す */
export function getHolidayMap(fromDate: string, toDate: string): Record<string, string> {
  const fromYear = parseInt(fromDate.slice(0, 4))
  const toYear = parseInt(toDate.slice(0, 4))
  const map: Record<string, string> = {}
  for (let y = fromYear; y <= toYear; y++) {
    for (const h of getHolidaysForYear(y)) {
      if (h.date >= fromDate && h.date <= toDate) {
        map[h.date] = h.name
      }
    }
  }
  return map
}

// ────────────────────────────────────────────────────────────
// サロン定休日（地域別）
// ────────────────────────────────────────────────────────────

export type SalonRegion = 'tokyo'

/**
 * 地域別の定休日ルール。
 * - peakMonths: 繁忙期（定休日なし）
 * - regularHolidayMondays: 通常期に休む「第N月曜」のリスト（1=第1, 2=第2, ...）
 * 地域追加時はここにエントリを足すだけで全予測ロジックに反映される。
 */
export const SALON_REGULAR_HOLIDAY_RULES: Record<SalonRegion, {
  peakMonths: number[]
  regularHolidayMondays: number[]
}> = {
  tokyo: {
    peakMonths: [3, 7, 12],
    regularHolidayMondays: [2, 4],
  },
}

/** 指定日（YYYY-MM-DD）が指定地域の定休日かどうか */
export function isRegularHoliday(dateStr: string, region: SalonRegion = 'tokyo'): boolean {
  const rule = SALON_REGULAR_HOLIDAY_RULES[region]
  const year = parseInt(dateStr.slice(0, 4))
  const month = parseInt(dateStr.slice(5, 7))
  const day = parseInt(dateStr.slice(8, 10))
  if (rule.peakMonths.includes(month)) return false
  // その日が「第N月曜」なら定休日
  const dow = new Date(year, month - 1, day).getDay()
  if (dow !== 1) return false
  // 何回目の月曜か
  const nth = Math.floor((day - 1) / 7) + 1
  return rule.regularHolidayMondays.includes(nth)
}

/** 指定年月の定休日リスト（YYYY-MM-DD） */
export function getRegularHolidaysForMonth(
  year: number,
  month: number,
  region: SalonRegion = 'tokyo'
): string[] {
  const rule = SALON_REGULAR_HOLIDAY_RULES[region]
  if (rule.peakMonths.includes(month)) return []
  const pad = (n: number) => String(n).padStart(2, '0')
  const result: string[] = []
  for (const nth of rule.regularHolidayMondays) {
    const day = getNthMonday(year, month, nth)
    const daysInMonth = new Date(year, month, 0).getDate()
    if (day >= 1 && day <= daysInMonth) {
      result.push(`${year}-${pad(month)}-${pad(day)}`)
    }
  }
  return result
}

/** 指定期間の定休日Map（true値） */
export function getRegularHolidayMap(
  fromDate: string,
  toDate: string,
  region: SalonRegion = 'tokyo'
): Record<string, true> {
  const map: Record<string, true> = {}
  const fromY = parseInt(fromDate.slice(0, 4))
  const fromM = parseInt(fromDate.slice(5, 7))
  const toY = parseInt(toDate.slice(0, 4))
  const toM = parseInt(toDate.slice(5, 7))
  let y = fromY
  let m = fromM
  while (y < toY || (y === toY && m <= toM)) {
    for (const date of getRegularHolidaysForMonth(y, m, region)) {
      if (date >= fromDate && date <= toDate) map[date] = true
    }
    m++
    if (m > 12) { m = 1; y++ }
  }
  return map
}
