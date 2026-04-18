import { NextResponse } from 'next/server'
import {
  getMonthlyTotalSales,
  getMonthlyStoreSales,
  getDayOfWeekSales,
  getStoreDayOfWeekSales,
  getDayOfWeekUtilization,
  getStoreDayOfWeekUtilization,
  getDailySales,
  getStoreDailySales,
  getMonthlyTargets,
  getAnnualTarget,
  getSeasonalIndex,
  getStoreOpeningPlans,
  getStoreOpeningRevenue,
} from '@/lib/db'
import { STORES, MAX_REVENUE_PER_SEAT, isClosedStore } from '@/lib/stores'
import { getHolidayMap } from '@/lib/holidays'

export const revalidate = 0

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土']

export async function GET() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
  const toYear = now.getFullYear()
  const toMonth = now.getMonth() + 1

  // ── 客単価×客数 分解分析 ──────────────────────────────────────────────
  // 過去12ヶ月の月別データ
  const fromYear = toMonth <= 12 ? toYear - 1 : toYear
  const fromMonth2 = ((toMonth - 1 + 12) % 12) + 1
  const totalMonthly = getMonthlyTotalSales(fromYear, fromMonth2, toYear, toMonth)
  const storeMonthly = getMonthlyStoreSales(fromYear, fromMonth2, toYear, toMonth)

  // 全店合計の客単価×客数分解
  const priceVolumeDecomposition = totalMonthly.map((m, i) => {
    const unitPrice = m.customers > 0 ? Math.round(m.sales / m.customers) : 0
    const prev = i > 0 ? totalMonthly[i - 1] : null
    const prevUnitPrice = prev && prev.customers > 0 ? Math.round(prev.sales / prev.customers) : null
    const prevCustomers = prev ? prev.customers : null

    // 分解: ΔSales = ΔPrice × avgCustomers + ΔCustomers × avgPrice
    let priceEffect: number | null = null
    let volumeEffect: number | null = null
    if (prevUnitPrice !== null && prevCustomers !== null) {
      const avgCustomers = (m.customers + prevCustomers) / 2
      const avgPrice = (unitPrice + prevUnitPrice) / 2
      priceEffect = Math.round((unitPrice - prevUnitPrice) * avgCustomers)
      volumeEffect = Math.round((m.customers - prevCustomers) * avgPrice)
    }

    return {
      month: m.month,
      sales: m.sales,
      customers: m.customers,
      unitPrice,
      priceEffect,
      volumeEffect,
    }
  })

  // 店舗別の客単価×客数分解
  const storeDecomposition: Record<string, typeof priceVolumeDecomposition> = {}
  const storeGrouped = new Map<string, typeof totalMonthly>()
  for (const row of storeMonthly) {
    if (!storeGrouped.has(row.store)) storeGrouped.set(row.store, [])
    storeGrouped.get(row.store)!.push(row)
  }
  for (const [store, months] of storeGrouped) {
    if (isClosedStore(store)) continue
    storeDecomposition[store] = months.map((m, i) => {
      const unitPrice = m.customers > 0 ? Math.round(m.sales / m.customers) : 0
      const prev = i > 0 ? months[i - 1] : null
      const prevUnitPrice = prev && prev.customers > 0 ? Math.round(prev.sales / prev.customers) : null
      const prevCustomers = prev ? prev.customers : null
      let priceEffect: number | null = null
      let volumeEffect: number | null = null
      if (prevUnitPrice !== null && prevCustomers !== null) {
        const avgCustomers = (m.customers + prevCustomers) / 2
        const avgPrice = (unitPrice + prevUnitPrice) / 2
        priceEffect = Math.round((unitPrice - prevUnitPrice) * avgCustomers)
        volumeEffect = Math.round((m.customers - prevCustomers) * avgPrice)
      }
      return {
        month: m.month,
        sales: m.sales,
        customers: m.customers,
        unitPrice,
        priceEffect,
        volumeEffect,
      }
    })
  }

  // ── 曜日別売上パターン ─────────────────────────────────────────────
  // 直近3ヶ月分の曜日別集計
  const dowFromMonth = toMonth <= 3 ? toMonth + 9 : toMonth - 3
  const dowFromYear = toMonth <= 3 ? toYear - 1 : toYear
  const dowAll = getDayOfWeekSales(dowFromYear, dowFromMonth, toYear, toMonth)
  const dowByStore = getStoreDayOfWeekSales(dowFromYear, dowFromMonth, toYear, toMonth)

  const dowSummary = dowAll.map(d => ({
    dow: d.dow,
    label: DOW_LABELS[d.dow],
    days: d.days,
    avgSales: d.avgSales,
    avgCustomers: d.avgCustomers,
    avgUnitPrice: d.avgCustomers > 0 ? Math.round(d.totalSales / d.totalCustomers) : 0,
  }))

  // 店舗別曜日データ
  const dowByStoreGrouped: Record<string, typeof dowSummary> = {}
  for (const d of dowByStore) {
    if (isClosedStore(d.store)) continue
    if (!dowByStoreGrouped[d.store]) dowByStoreGrouped[d.store] = []
    dowByStoreGrouped[d.store].push({
      dow: d.dow,
      label: DOW_LABELS[d.dow],
      days: d.days,
      avgSales: d.avgSales,
      avgCustomers: d.avgCustomers,
      avgUnitPrice: d.avgCustomers > 0 ? Math.round(d.totalSales / d.totalCustomers) : 0,
    })
  }

  // ── 曜日別稼働率 ──────────────────────────────────────────────────
  const utilAll = getDayOfWeekUtilization(dowFromYear, dowFromMonth, toYear, toMonth)
  const utilByStore = getStoreDayOfWeekUtilization(dowFromYear, dowFromMonth, toYear, toMonth)

  const dowUtilization = utilAll.map(u => ({
    dow: u.dow,
    label: DOW_LABELS[u.dow],
    avgRate: u.avgRate,
    days: u.days,
  }))

  const dowUtilByStore: Record<string, typeof dowUtilization> = {}
  for (const u of utilByStore) {
    if (isClosedStore(u.store)) continue
    if (!dowUtilByStore[u.store]) dowUtilByStore[u.store] = []
    dowUtilByStore[u.store].push({
      dow: u.dow,
      label: DOW_LABELS[u.dow],
      avgRate: u.avgRate,
      days: u.days,
    })
  }

  // ── 週単位データ ─────────────────────────────────────────────────
  // 今週・先週・前月同週のデータを日別で返す
  const jstNow = now
  const todayStr = `${jstNow.getFullYear()}-${String(jstNow.getMonth() + 1).padStart(2, '0')}-${String(jstNow.getDate()).padStart(2, '0')}`

  // 今週の月曜日を求める（月曜始まり）
  const dayOfWeek = jstNow.getDay() // 0=日, 1=月
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const thisMonday = new Date(jstNow)
  thisMonday.setDate(jstNow.getDate() + mondayOffset)
  const thisSunday = new Date(thisMonday)
  thisSunday.setDate(thisMonday.getDate() + 6)

  // 先週
  const lastMonday = new Date(thisMonday)
  lastMonday.setDate(thisMonday.getDate() - 7)
  const lastSunday = new Date(thisMonday)
  lastSunday.setDate(thisMonday.getDate() - 1)

  // 前月の同じ週（月曜基準で4週間前）
  const prevMonthMonday = new Date(thisMonday)
  prevMonthMonday.setDate(thisMonday.getDate() - 28)
  const prevMonthSunday = new Date(prevMonthMonday)
  prevMonthSunday.setDate(prevMonthMonday.getDate() + 6)

  const fmtDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  const thisWeekFrom = fmtDate(thisMonday)
  const thisWeekTo = fmtDate(thisSunday)
  const lastWeekFrom = fmtDate(lastMonday)
  const lastWeekTo = fmtDate(lastSunday)
  const prevMonthWeekFrom = fmtDate(prevMonthMonday)
  const prevMonthWeekTo = fmtDate(prevMonthSunday)

  // 全3週分を一括取得（最小クエリ）
  const allWeekFrom = prevMonthWeekFrom < lastWeekFrom ? prevMonthWeekFrom : lastWeekFrom
  const allDailySales = getDailySales(allWeekFrom, thisWeekTo)
  const allStoreDailySales = getStoreDailySales(allWeekFrom, thisWeekTo)

  // 祝日マップ
  const holidayMap = getHolidayMap(allWeekFrom, thisWeekTo)

  // ヘルパー: 日付範囲でフィルタ
  const filterByRange = (rows: typeof allDailySales, from: string, to: string) =>
    rows.filter(r => r.date >= from && r.date <= to)

  // 曜日別平均売上（今週の予測に使用）
  const dowAvgForForecast: Record<number, number> = {}
  const dowAvgCustomersForForecast: Record<number, number> = {}
  for (const d of dowAll) {
    dowAvgForForecast[d.dow] = d.avgSales
    dowAvgCustomersForForecast[d.dow] = d.avgCustomers
  }

  // 店舗別・曜日別平均売上（店舗絞込時の予測に使用）
  const dowAvgByStoreForForecast: Record<string, Record<number, number>> = {}
  const dowAvgCustomersByStoreForForecast: Record<string, Record<number, number>> = {}
  for (const d of dowByStore) {
    if (isClosedStore(d.store)) continue
    if (!dowAvgByStoreForForecast[d.store]) dowAvgByStoreForForecast[d.store] = {}
    if (!dowAvgCustomersByStoreForForecast[d.store]) dowAvgCustomersByStoreForForecast[d.store] = {}
    dowAvgByStoreForForecast[d.store][d.dow] = d.avgSales
    dowAvgCustomersByStoreForForecast[d.store][d.dow] = d.avgCustomers
  }

  const buildWeekDays = (rows: typeof allDailySales, mondayDate: Date) => {
    const days: {
      date: string; dow: number; dowLabel: string; sales: number; customers: number
      holiday: string | null; forecast: number; forecastCustomers: number
      isFuture: boolean; isToday: boolean
    }[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(mondayDate)
      d.setDate(mondayDate.getDate() + i)
      const dateStr = fmtDate(d)
      const dayData = rows.find(r => r.date === dateStr)
      const dow = d.getDay()
      const dowLabels = ['日', '月', '火', '水', '木', '金', '土']
      const isFuture = dateStr > todayStr
      const isToday = dateStr === todayStr
      days.push({
        date: dateStr,
        dow,
        dowLabel: dowLabels[dow],
        sales: dayData?.sales ?? 0,
        customers: dayData?.customers ?? 0,
        holiday: holidayMap[dateStr] ?? null,
        forecast: dowAvgForForecast[dow] ?? 0,
        forecastCustomers: dowAvgCustomersForForecast[dow] ?? 0,
        isFuture,
        isToday,
      })
    }
    return days
  }

  // 店舗別週データ
  const buildStoreWeekDays = (rows: typeof allStoreDailySales, from: string, to: string) => {
    const filtered = rows.filter(r => r.date >= from && r.date <= to)
    const byStore: Record<string, Record<string, { sales: number; customers: number }>> = {}
    for (const r of filtered) {
      if (isClosedStore(r.store)) continue
      if (!byStore[r.store]) byStore[r.store] = {}
      byStore[r.store][r.date] = { sales: r.sales, customers: r.customers }
    }
    return byStore
  }

  const weeklyData = {
    thisWeek: {
      label: `今週 (${thisWeekFrom.slice(5)} 〜 ${thisWeekTo.slice(5)})`,
      from: thisWeekFrom,
      to: thisWeekTo,
      days: buildWeekDays(filterByRange(allDailySales, thisWeekFrom, thisWeekTo), thisMonday),
      storeData: buildStoreWeekDays(allStoreDailySales, thisWeekFrom, thisWeekTo),
    },
    lastWeek: {
      label: `先週 (${lastWeekFrom.slice(5)} 〜 ${lastWeekTo.slice(5)})`,
      from: lastWeekFrom,
      to: lastWeekTo,
      days: buildWeekDays(filterByRange(allDailySales, lastWeekFrom, lastWeekTo), lastMonday),
      storeData: buildStoreWeekDays(allStoreDailySales, lastWeekFrom, lastWeekTo),
    },
    prevMonthWeek: {
      label: `前月同週 (${prevMonthWeekFrom.slice(5)} 〜 ${prevMonthWeekTo.slice(5)})`,
      from: prevMonthWeekFrom,
      to: prevMonthWeekTo,
      days: buildWeekDays(filterByRange(allDailySales, prevMonthWeekFrom, prevMonthWeekTo), prevMonthMonday),
      storeData: buildStoreWeekDays(allStoreDailySales, prevMonthWeekFrom, prevMonthWeekTo),
    },
    holidayMap,
    dowAvgByStore: dowAvgByStoreForForecast,
    dowAvgCustomersByStore: dowAvgCustomersByStoreForForecast,
  }

  // ── 目標サジェスト ──────────────────────────────────────────────────
  // 各月の目標を席数・成長率・季節変動から提案
  const seasonalIndex = getSeasonalIndex(toYear)
  const prevYearMonthly = getMonthlyTotalSales(toYear - 1, 1, toYear - 1, 12)
  const currentYearMonthly = getMonthlyTotalSales(toYear, 1, toYear, toMonth)
  const existingTargets = getMonthlyTargets(toYear)
  const annualTarget = getAnnualTarget(toYear)

  // 全店合計の席数上限（既存店＋新店の席数を月別に考慮）
  const existingSeats = STORES.filter(s => !isClosedStore(s.name)).reduce((s, st) => s + st.seats, 0)
  const storePlans = getStoreOpeningPlans(toYear)
  const storeOpeningRevenue = getStoreOpeningRevenue(toYear)

  // 月別の新店売上寄与
  const newStoreRevenueByMonth: Record<number, number> = {}
  const newStoreDetailByMonth: Record<number, { name: string; revenue: number }[]> = {}
  for (const sr of storeOpeningRevenue) {
    newStoreRevenueByMonth[sr.month] = (newStoreRevenueByMonth[sr.month] ?? 0) + sr.revenue
    if (!newStoreDetailByMonth[sr.month]) newStoreDetailByMonth[sr.month] = []
    newStoreDetailByMonth[sr.month].push({ name: sr.storeName, revenue: sr.revenue })
  }

  // 月別の総席数（既存＋新店）
  const getMonthlySeats = (mo: number) => {
    let seats = existingSeats
    for (const plan of storePlans) {
      if (plan.opening_month <= mo) seats += (plan.seats ?? 0)
    }
    return seats
  }

  const totalSeats = existingSeats // 基本席数（表示用）
  const monthlyRevenueCeiling = existingSeats * MAX_REVENUE_PER_SEAT
  const realisticCeiling = Math.round(monthlyRevenueCeiling * 0.85)

  // YoY成長率（完了月ベース）
  const yoyRates: number[] = []
  for (const cm of currentYearMonthly) {
    if (cm.month === `${toYear}-${String(toMonth).padStart(2, '0')}`) continue
    const [, mStr] = cm.month.split('-')
    const mo = parseInt(mStr)
    const prev = prevYearMonthly.find(p => {
      const [, pMStr] = p.month.split('-')
      return parseInt(pMStr) === mo
    })
    if (prev && prev.sales > 0) {
      yoyRates.push((cm.sales - prev.sales) / prev.sales)
    }
  }
  const avgYoYRate = yoyRates.length > 0
    ? yoyRates.reduce((a, b) => a + b, 0) / yoyRates.length
    : null

  // 月別サジェスト
  const targetSuggestions: {
    month: number
    suggested: number
    existing: number | null
    rationale: string[]
    newStoreRevenue: number
    newStoreDetail: { name: string; revenue: number }[]
    commentary: string | null
    basis: {
      prevYear: number | null
      yoyRate: number | null
      seasonal: number | null
      ceiling: number
      monthSeats: number
      monthCeiling: number
    }
  }[] = []

  for (let mo = 1; mo <= 12; mo++) {
    const moStr = String(mo).padStart(2, '0')
    const prevData = prevYearMonthly.find(p => p.month.endsWith(`-${moStr}`))
    const prevSales = prevData?.sales ?? null
    const seasonal = seasonalIndex[mo] ?? null
    const existing = existingTargets[mo] ?? null
    const newStoreRev = newStoreRevenueByMonth[mo] ?? 0
    const newStoreDetail = newStoreDetailByMonth[mo] ?? []

    // 月別の席数・上限を算出（新店含む）
    const monthSeats = getMonthlySeats(mo)
    const monthCeiling = Math.round(monthSeats * MAX_REVENUE_PER_SEAT * 0.85)

    let suggested: number
    const rationale: string[] = []

    if (prevSales && avgYoYRate !== null) {
      // ベース: 前年同月 × (1 + 成長率) — 既存店分
      const base = Math.round(prevSales * (1 + avgYoYRate))
      rationale.push(`前年${mo}月 ${(prevSales / 10000).toFixed(0)}万 × 成長率${(avgYoYRate * 100).toFixed(1)}%`)

      // 季節変動で補正
      if (seasonal !== null && seasonal > 0) {
        suggested = Math.round(base * Math.max(seasonal, 0.7))
        if (Math.abs(seasonal - 1.0) > 0.05) {
          rationale.push(`季節変動 ${(seasonal * 100).toFixed(0)}%で補正`)
        }
      } else {
        suggested = base
      }

      // 新店売上を上乗せ
      if (newStoreRev > 0) {
        suggested += newStoreRev
        const storeNames = newStoreDetail.map(d => d.name).join('・')
        rationale.push(`新店(${storeNames})売上 +${Math.round(newStoreRev / 10000)}万を加算`)
      }

      // 月別席数上限でキャップ
      if (suggested > monthCeiling) {
        suggested = monthCeiling
        rationale.push(`席数上限(${monthSeats}席×85%)でキャップ`)
      }

      // 攻めの目標
      const aggressive = Math.round(suggested * 1.08)
      suggested = Math.min(aggressive, monthCeiling)
      rationale.push(`攻め目標として+8%上乗せ`)
    } else if (prevSales) {
      suggested = Math.round(prevSales * 1.1) + newStoreRev
      rationale.push(`前年同月 +10%（成長データ不足）`)
      if (newStoreRev > 0) rationale.push(`新店売上 +${Math.round(newStoreRev / 10000)}万`)
    } else {
      const avgMonthly = currentYearMonthly.length > 0
        ? currentYearMonthly.reduce((s, m) => s + m.sales, 0) / currentYearMonthly.length
        : realisticCeiling * 0.6
      suggested = Math.round(avgMonthly * 1.05) + newStoreRev
      rationale.push(`今期平均 ×105%（前年データなし）`)
      if (newStoreRev > 0) rationale.push(`新店売上 +${Math.round(newStoreRev / 10000)}万`)
    }

    // コメンタリー生成（目標との乖離分析）
    let commentary: string | null = null
    if (existing !== null && existing > 0) {
      const diff = suggested - existing
      const diffPct = Math.round(diff / existing * 100)
      if (Math.abs(diffPct) <= 5) {
        commentary = `現在目標は妥当な水準です。提案値との差は${Math.abs(diffPct)}%以内。`
      } else if (diff > 0) {
        commentary = `現在目標が提案より${Math.round(diff / 10000)}万円低め（${diffPct}%差）。${newStoreRev > 0 ? '新店オープンを考慮すると' : '成長トレンドを考慮すると'}目標の上方修正を検討。`
      } else {
        commentary = `現在目標が提案より${Math.round(Math.abs(diff) / 10000)}万円高め（${Math.abs(diffPct)}%差）。達成難度が高い可能性。${seasonal !== null && seasonal < 0.9 ? '閑散期のため特に注意。' : ''}`
      }
    } else if (newStoreRev > 0) {
      commentary = `新店オープンにより売上が+${Math.round(newStoreRev / 10000)}万見込み。早期に月次目標を設定することを推奨。`
    }

    targetSuggestions.push({
      month: mo,
      suggested,
      existing,
      rationale,
      newStoreRevenue: newStoreRev,
      newStoreDetail,
      commentary,
      basis: {
        prevYear: prevSales,
        yoyRate: avgYoYRate !== null ? Math.round(avgYoYRate * 1000) / 10 : null,
        seasonal,
        ceiling: realisticCeiling,
        monthSeats,
        monthCeiling,
      },
    })
  }

  const suggestedAnnualTotal = targetSuggestions.reduce((s, t) => s + t.suggested, 0)

  // 出店計画サマリー
  const storePlansSummary = storePlans.map(p => ({
    name: p.store_name,
    month: p.opening_month,
    revenue: p.max_monthly_revenue,
    seats: p.seats ?? 0,
  }))

  return NextResponse.json({
    priceVolumeDecomposition,
    storeDecomposition,
    dowSummary,
    dowByStore: dowByStoreGrouped,
    dowUtilization,
    dowUtilByStore,
    weeklyData,
    targetSuggestions,
    suggestedAnnualTotal,
    existingAnnualTarget: annualTarget,
    realisticCeiling,
    totalSeats,
    storePlansSummary,
  })
}
