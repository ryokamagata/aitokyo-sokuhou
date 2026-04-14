import { NextResponse } from 'next/server'
import { getDB } from '@/lib/db'
import {
  getMonthlyTotalSales,
  getMonthlyStoreSales,
  getDailySales,
  getDayOfWeekSales,
} from '@/lib/db'
import { STORES, MAX_REVENUE_PER_SEAT, isClosedStore } from '@/lib/stores'
import { getHolidayMap } from '@/lib/holidays'

export const revalidate = 0

export async function GET() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const db = getDB()

  // ── 1. 顧客リピート分析 ──────────────────────────────────
  const fromYM12 = month === 12 ? year * 100 + 1 : (year - 1) * 100 + (month + 1)
  const toYM = year * 100 + month

  // 月別全店合計の来客分類
  const visitorMonthly = db.prepare(`
    SELECT year, month,
           SUM(nominated) as nominated, SUM(free_visit) as free_visit,
           SUM(new_customers) as new_customers, SUM(revisit) as revisit
    FROM store_monthly_visitors
    WHERE (year * 100 + month) >= ? AND (year * 100 + month) <= ?
    GROUP BY year, month
    ORDER BY year ASC, month ASC
  `).all(fromYM12, toYM) as {
    year: number; month: number; nominated: number; free_visit: number
    new_customers: number; revisit: number
  }[]

  // 店舗別来客分類
  const visitorByStore = db.prepare(`
    SELECT year, month, store,
           nominated, free_visit, new_customers, revisit
    FROM store_monthly_visitors
    WHERE (year * 100 + month) >= ? AND (year * 100 + month) <= ?
    ORDER BY year ASC, month ASC
  `).all(fromYM12, toYM) as {
    year: number; month: number; store: string
    nominated: number; free_visit: number; new_customers: number; revisit: number
  }[]

  // 3ヶ月リピート率推移
  const cycleData = db.prepare(`
    SELECT year, month, store, new_return_3m
    FROM store_monthly_cycle
    WHERE (year * 100 + month) >= ? AND (year * 100 + month) <= ?
    ORDER BY year ASC, month ASC
  `).all(fromYM12, toYM) as {
    year: number; month: number; store: string; new_return_3m: number
  }[]

  // 全店合計の月次指名率・フリー率推移
  const customerRepeatMonthly = visitorMonthly.map(v => {
    const total = v.nominated + v.free_visit + v.new_customers + v.revisit
    return {
      month: `${v.year}-${String(v.month).padStart(2, '0')}`,
      nominated: v.nominated,
      free: v.free_visit,
      newCustomers: v.new_customers,
      revisit: v.revisit,
      total,
      nominationRate: total > 0 ? Math.round(v.nominated / total * 1000) / 10 : 0,
      freeRate: total > 0 ? Math.round(v.free_visit / total * 1000) / 10 : 0,
      newRate: total > 0 ? Math.round(v.new_customers / total * 1000) / 10 : 0,
    }
  })

  // 店舗別リピート率（3ヶ月リターン率）ランキング
  const latestCycleByStore: Record<string, { rate: number; month: string }> = {}
  for (const c of cycleData) {
    if (isClosedStore(c.store)) continue
    const key = c.store
    const mo = `${c.year}-${String(c.month).padStart(2, '0')}`
    if (!latestCycleByStore[key] || mo > latestCycleByStore[key].month) {
      latestCycleByStore[key] = { rate: c.new_return_3m, month: mo }
    }
  }
  const storeReturnRanking = Object.entries(latestCycleByStore)
    .map(([store, d]) => ({ store, rate: d.rate, month: d.month }))
    .sort((a, b) => b.rate - a.rate)

  // 3ヶ月リピート率月次推移（全店平均）
  const cycleByMonth: Record<string, number[]> = {}
  for (const c of cycleData) {
    if (isClosedStore(c.store)) continue
    const mo = `${c.year}-${String(c.month).padStart(2, '0')}`
    if (!cycleByMonth[mo]) cycleByMonth[mo] = []
    if (c.new_return_3m > 0) cycleByMonth[mo].push(c.new_return_3m)
  }
  const returnRateTrend = Object.entries(cycleByMonth)
    .map(([mo, rates]) => ({
      month: mo,
      avgRate: rates.length > 0 ? Math.round(rates.reduce((s, r) => s + r, 0) / rates.length * 10) / 10 : 0,
    }))
    .sort((a, b) => a.month.localeCompare(b.month))

  // ── 2. スタッフ生産性分析 ──────────────────────────────────
  const fromYM6 = month <= 6
    ? (year - 1) * 100 + (month + 6)
    : year * 100 + (month - 6)

  const staffSales = db.prepare(`
    SELECT year, month, staff, store, SUM(sales) as sales
    FROM staff_period_sales
    WHERE (year * 100 + month) >= ? AND (year * 100 + month) <= ?
    GROUP BY year, month, staff
    ORDER BY year ASC, month ASC, sales DESC
  `).all(fromYM6, toYM) as {
    year: number; month: number; staff: string; store: string; sales: number
  }[]

  // スタッフ別月次推移
  const staffByName: Record<string, { months: Record<string, number>; store: string }> = {}
  for (const s of staffSales) {
    if (!staffByName[s.staff]) staffByName[s.staff] = { months: {}, store: s.store }
    const mo = `${s.year}-${String(s.month).padStart(2, '0')}`
    staffByName[s.staff].months[mo] = (staffByName[s.staff].months[mo] ?? 0) + s.sales
    staffByName[s.staff].store = s.store
  }

  // 直近3ヶ月 vs 前3ヶ月の成長率
  const allMonths = [...new Set(staffSales.map(s => `${s.year}-${String(s.month).padStart(2, '0')}`))].sort()
  const recent3 = allMonths.slice(-3)
  const prev3 = allMonths.slice(-6, -3)

  const staffGrowth = Object.entries(staffByName).map(([staff, data]) => {
    const recentTotal = recent3.reduce((s, m) => s + (data.months[m] ?? 0), 0)
    const prevTotal = prev3.reduce((s, m) => s + (data.months[m] ?? 0), 0)
    const growthRate = prevTotal > 0 ? Math.round((recentTotal - prevTotal) / prevTotal * 1000) / 10 : null
    return { staff, store: data.store, recentTotal, prevTotal, growthRate }
  }).filter(s => s.recentTotal > 0)
    .sort((a, b) => (b.growthRate ?? -999) - (a.growthRate ?? -999))

  // 今月のスタッフランキング（客単価推定含む）
  const currentMonthStr = `${year}-${String(month).padStart(2, '0')}`
  const staffCurrentMonth = Object.entries(staffByName)
    .map(([staff, data]) => ({
      staff,
      store: data.store,
      sales: data.months[currentMonthStr] ?? 0,
    }))
    .filter(s => s.sales > 0)
    .sort((a, b) => b.sales - a.sales)

  // ── 3. 店舗ベンチマーク ──────────────────────────────────
  const currentMonthPrefix = `${year}-${String(month).padStart(2, '0')}`
  const storeSalesCurrentMonth = db.prepare(`
    SELECT store, SUM(sales) as sales, SUM(customers) as customers
    FROM store_daily_sales
    WHERE date LIKE ?
    GROUP BY store
  `).all(`${currentMonthPrefix}-%`) as { store: string; sales: number; customers: number }[]

  const storeUtilCurrentMonth = db.prepare(`
    SELECT store, ROUND(AVG(utilization_rate), 1) as avgRate
    FROM store_daily_utilization
    WHERE date LIKE ?
    GROUP BY store
  `).all(`${currentMonthPrefix}-%`) as { store: string; avgRate: number }[]

  const utilMap: Record<string, number> = {}
  for (const u of storeUtilCurrentMonth) utilMap[u.store] = u.avgRate

  const storeBenchmark = storeSalesCurrentMonth
    .filter(s => !isClosedStore(s.store))
    .map(s => {
      const storeConfig = STORES.find(st => s.store.includes(st.name) || st.name.includes(s.store))
      const seats = storeConfig?.seats ?? 10
      const revenuePerSeat = Math.round(s.sales / seats)
      const potential = seats * MAX_REVENUE_PER_SEAT
      const unitPrice = s.customers > 0 ? Math.round(s.sales / s.customers) : 0
      return {
        store: s.store,
        seats,
        sales: s.sales,
        customers: s.customers,
        unitPrice,
        revenuePerSeat,
        utilization: utilMap[s.store] ?? 0,
        potential,
        gap: potential - s.sales,
        achievementRate: Math.round(s.sales / potential * 1000) / 10,
      }
    })
    .sort((a, b) => b.revenuePerSeat - a.revenuePerSeat)

  // ── 4. 時系列・季節性分析 ──────────────────────────────────
  // 過去24ヶ月の月次データ
  const from24 = month === 12 ? (year - 1) : (year - 2)
  const fromMo24 = month === 12 ? 1 : month + 1
  const totalMonthly24 = getMonthlyTotalSales(from24, fromMo24, year, month)

  // 季節指数（月別平均からの乖離）
  const monthBuckets: Record<number, number[]> = {}
  for (const m of totalMonthly24) {
    const mo = parseInt(m.month.split('-')[1])
    if (!monthBuckets[mo]) monthBuckets[mo] = []
    monthBuckets[mo].push(m.sales)
  }
  const overallAvg = totalMonthly24.length > 0
    ? totalMonthly24.reduce((s, m) => s + m.sales, 0) / totalMonthly24.length
    : 1
  const seasonalIndex = Array.from({ length: 12 }, (_, i) => {
    const mo = i + 1
    const vals = monthBuckets[mo] ?? []
    const avg = vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : 0
    return {
      month: mo,
      label: `${mo}月`,
      index: overallAvg > 0 ? Math.round(avg / overallAvg * 100) / 100 : 0,
      avgSales: Math.round(avg),
    }
  })

  // 前年同月比の成長率
  const yoyGrowth: { month: string; current: number; prevYear: number; growthRate: number | null }[] = []
  for (const m of totalMonthly24) {
    const [yr, moStr] = m.month.split('-')
    const prevYearMonth = `${parseInt(yr) - 1}-${moStr}`
    const prev = totalMonthly24.find(p => p.month === prevYearMonth)
    if (prev) {
      yoyGrowth.push({
        month: m.month,
        current: m.sales,
        prevYear: prev.sales,
        growthRate: prev.sales > 0 ? Math.round((m.sales - prev.sales) / prev.sales * 1000) / 10 : null,
      })
    }
  }

  // 祝日インパクト分析（直近6ヶ月）
  const from6moDate = (() => {
    const d = new Date(year, month - 7, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  })()
  const todayStr = `${year}-${String(month).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const dailyForHolidays = getDailySales(from6moDate, todayStr)
  const holidayMap6 = getHolidayMap(from6moDate, todayStr)

  const holidaySales: number[] = []
  const nonHolidaySales: Record<number, number[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] }
  const holidayImpact: { date: string; name: string; sales: number; dow: number }[] = []

  for (const d of dailyForHolidays) {
    if (d.sales === 0) continue
    const dow = new Date(d.date + 'T00:00:00').getDay()
    if (holidayMap6[d.date]) {
      holidaySales.push(d.sales)
      holidayImpact.push({ date: d.date, name: holidayMap6[d.date], sales: d.sales, dow })
    } else {
      nonHolidaySales[dow].push(d.sales)
    }
  }

  // 祝日と同じ曜日の平均との比較
  const holidayImpactDetails = holidayImpact.map(h => {
    const sameDowAvg = nonHolidaySales[h.dow].length > 0
      ? Math.round(nonHolidaySales[h.dow].reduce((s, v) => s + v, 0) / nonHolidaySales[h.dow].length)
      : 0
    return {
      ...h,
      avgSameDow: sameDowAvg,
      impact: sameDowAvg > 0 ? Math.round((h.sales - sameDowAvg) / sameDowAvg * 1000) / 10 : 0,
    }
  })

  // ── 5. ABC分析（パレート分析） ──────────────────────────────────
  // スタッフABC（今月）
  const staffForABC = [...staffCurrentMonth].sort((a, b) => b.sales - a.sales)
  const staffTotalSales = staffForABC.reduce((s, st) => s + st.sales, 0)
  let staffCumPct = 0
  const staffABC = staffForABC.map(s => {
    staffCumPct += staffTotalSales > 0 ? s.sales / staffTotalSales * 100 : 0
    const grade = staffCumPct <= 80 ? 'A' : staffCumPct <= 95 ? 'B' : 'C'
    return { staff: s.staff, store: s.store, sales: s.sales, cumPct: Math.round(staffCumPct * 10) / 10, grade }
  })

  // 店舗ABC（今月）
  const storesForABC = [...storeBenchmark].sort((a, b) => b.sales - a.sales)
  const storeTotalSales = storesForABC.reduce((s, st) => s + st.sales, 0)
  let storeCumPct = 0
  const storeABC = storesForABC.map(s => {
    storeCumPct += storeTotalSales > 0 ? s.sales / storeTotalSales * 100 : 0
    const grade = storeCumPct <= 80 ? 'A' : storeCumPct <= 95 ? 'B' : 'C'
    return { store: s.store, sales: s.sales, cumPct: Math.round(storeCumPct * 10) / 10, grade }
  })

  const staffACount = staffABC.filter(s => s.grade === 'A').length
  const staffAShare = staffABC.length > 0
    ? Math.round(staffACount / staffABC.length * 1000) / 10
    : 0

  // ── 6. 予測精度分析 ──────────────────────────────────────
  // 過去6ヶ月の各月について、DAY=10, 15, 20 時点のDOW予測 vs 実績を検証
  const forecastAccuracyMonths: {
    month: string
    actual: number
    forecasts: { day: number; forecast: number; accuracy: number }[]
  }[] = []

  for (let i = 1; i <= 6; i++) {
    const tgtDate = new Date(year, month - 1 - i, 1)
    const tgtYear = tgtDate.getFullYear()
    const tgtMonth = tgtDate.getMonth() + 1
    const daysInMonth = new Date(tgtYear, tgtMonth, 0).getDate()
    const tgtPrefix = `${tgtYear}-${String(tgtMonth).padStart(2, '0')}`

    const monthDailySales = db.prepare(`
      SELECT date, SUM(sales) as sales
      FROM store_daily_sales
      WHERE date LIKE ?
      GROUP BY date ORDER BY date ASC
    `).all(`${tgtPrefix}-%`) as { date: string; sales: number }[]

    if (monthDailySales.length === 0) continue

    const actualTotal = monthDailySales.reduce((s, d) => s + d.sales, 0)

    // 曜日別平均を計算（その月のデータから）
    const forecasts: { day: number; forecast: number; accuracy: number }[] = []
    for (const checkpoint of [10, 15, 20]) {
      if (checkpoint > daysInMonth) continue
      const salesUpToDay = monthDailySales.filter(d => {
        const dayNum = parseInt(d.date.split('-')[2])
        return dayNum <= checkpoint
      })
      const actualSoFar = salesUpToDay.reduce((s, d) => s + d.sales, 0)

      // DOW average from data up to checkpoint
      const dowBuckets: Record<number, number[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] }
      for (const d of salesUpToDay) {
        if (d.sales > 0) {
          const dow = new Date(d.date + 'T00:00:00').getDay()
          dowBuckets[dow].push(d.sales)
        }
      }
      const dowAvg: Record<number, number> = {}
      for (let dow = 0; dow <= 6; dow++) {
        const vals = dowBuckets[dow]
        dowAvg[dow] = vals.length > 0 ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : 0
      }

      // Project remaining days
      let projected = 0
      for (let d = checkpoint + 1; d <= daysInMonth; d++) {
        const futureDate = new Date(tgtYear, tgtMonth - 1, d)
        projected += dowAvg[futureDate.getDay()] ?? 0
      }

      const forecastTotal = actualSoFar + projected
      const accuracy = actualTotal > 0 ? Math.round((1 - Math.abs(forecastTotal - actualTotal) / actualTotal) * 1000) / 10 : 0

      forecasts.push({ day: checkpoint, forecast: forecastTotal, accuracy })
    }

    forecastAccuracyMonths.push({
      month: tgtPrefix,
      actual: actualTotal,
      forecasts,
    })
  }

  // 曜日別予測精度
  const dowAccuracy: { dow: number; label: string; avgError: number }[] = []
  const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土']

  // 直近3ヶ月の曜日別実績 vs DOW平均予測
  const dowFrom = month <= 3 ? (year - 1) : year
  const dowFromMo = month <= 3 ? month + 9 : month - 3
  const dowStats = getDayOfWeekSales(dowFrom, dowFromMo, year, month)

  for (const d of dowStats) {
    // 曜日ごとの変動係数（CV）で精度を推定
    const dailyData = dailyForHolidays.filter(dd => {
      const dow = new Date(dd.date + 'T00:00:00').getDay()
      return dow === d.dow && dd.sales > 0
    })
    const avg = dailyData.length > 0 ? dailyData.reduce((s, dd) => s + dd.sales, 0) / dailyData.length : 0
    const variance = dailyData.length > 1
      ? dailyData.reduce((s, dd) => s + Math.pow(dd.sales - avg, 2), 0) / (dailyData.length - 1)
      : 0
    const cv = avg > 0 ? Math.round(Math.sqrt(variance) / avg * 1000) / 10 : 0

    dowAccuracy.push({
      dow: d.dow,
      label: DOW_LABELS[d.dow],
      avgError: cv,
    })
  }

  return NextResponse.json({
    // 1. 顧客リピート分析
    customerRepeat: {
      monthly: customerRepeatMonthly,
      storeReturnRanking,
      returnRateTrend,
    },
    // 2. スタッフ生産性分析
    staffProductivity: {
      currentMonth: staffCurrentMonth,
      growth: staffGrowth,
      monthlyTrends: staffByName,
    },
    // 3. 店舗ベンチマーク
    storeBenchmark,
    // 4. 季節性分析
    seasonal: {
      seasonalIndex,
      yoyGrowth,
      holidayImpact: holidayImpactDetails,
    },
    // 5. ABC分析
    abc: {
      staff: staffABC,
      stores: storeABC,
      staffAShare,
      staffACount,
      staffTotal: staffABC.length,
    },
    // 6. 予測精度分析
    forecastAccuracy: {
      months: forecastAccuracyMonths,
      dowAccuracy,
    },
  })
}
