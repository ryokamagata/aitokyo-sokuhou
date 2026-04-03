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
