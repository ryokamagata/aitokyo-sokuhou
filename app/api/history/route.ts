import { NextResponse } from 'next/server'
import {
  getMonthlyTotalSales,
  getMonthlyStoreSales,
  getMonthlyStaffSales,
} from '@/lib/db'
import { normalizeStaffName } from '@/lib/staffNormalize'

export const revalidate = 0

// 年間サマリー型
interface AnnualMonthDetail {
  month: number       // 1-12
  sales: number
  customers: number
  isProjected: boolean // true = 予測値
}

interface AnnualSummary {
  year: number
  total: number
  customers: number
  monthDetails: AnnualMonthDetail[]
  isComplete: boolean   // 12ヶ月すべて実績あり
  actualMonths: number  // 実績月数
}

interface Projection {
  currentYear: number
  projectedTotal: number
  projectedCustomers: number
  ytdTotal: number
  ytdCustomers: number
  ytdMonths: number
  avgYoYGrowthRate: number | null      // 前年同月比の平均成長率
  monthDetails: AnnualMonthDetail[]     // 12ヶ月分（実績+予測）
  prevYearTotal: number
  yoyProjectedGrowth: number | null     // 着地予測の前年比
}

export async function GET() {
  // 2024年8月〜当月
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
  const toYear = now.getFullYear()
  const toMonth = now.getMonth() + 1

  const fromYear = 2024
  const fromMonth = 8

  const totalMonthly = getMonthlyTotalSales(fromYear, fromMonth, toYear, toMonth)
  const storeMonthly = getMonthlyStoreSales(fromYear, fromMonth, toYear, toMonth)
  const staffMonthly = getMonthlyStaffSales(fromYear, fromMonth, toYear, toMonth)

  // 店舗別を月ごとにグループ化
  const storeByMonth: Record<string, { store: string; sales: number; customers: number }[]> = {}
  for (const row of storeMonthly) {
    if (!storeByMonth[row.month]) storeByMonth[row.month] = []
    storeByMonth[row.month].push({ store: row.store, sales: row.sales, customers: row.customers })
  }

  // スタッフ別: 名前を正規化して同一人物の売上を統合
  const staffMerged = new Map<string, { displayName: string; monthData: Map<string, number> }>()

  for (const row of staffMonthly) {
    const normalized = normalizeStaffName(row.staff)
    const monthKey = `${row.year}-${String(row.month).padStart(2, '0')}`

    let entry = staffMerged.get(normalized)
    if (!entry) {
      entry = { displayName: normalized, monthData: new Map() }
      staffMerged.set(normalized, entry)
    }
    entry.monthData.set(monthKey, (entry.monthData.get(monthKey) ?? 0) + row.sales)
  }

  // スタッフごとに直近月の売上と前月比を計算
  const months = totalMonthly.map(m => m.month)

  // スタッフデータが実際にある月を特定（staff_period_salesベース）
  const staffMonthsSet = new Set<string>()
  for (const [, { monthData }] of staffMerged) {
    for (const mk of monthData.keys()) staffMonthsSet.add(mk)
  }
  const staffMonths = Array.from(staffMonthsSet).sort()
  const staffLatestMonth = staffMonths[staffMonths.length - 1] || ''
  const staffPrevMonth = staffMonths.length >= 2 ? staffMonths[staffMonths.length - 2] : ''
  const staffPrev2Month = staffMonths.length >= 3 ? staffMonths[staffMonths.length - 3] : ''

  // 全体の最新月（表示用）
  const latestMonth = months[months.length - 1] || ''
  const prevMonth = months.length >= 2 ? months[months.length - 2] : ''

  // スタッフ別: 最新月売上30万円以下を除外（スタイリストのみ表示）
  const MIN_SALES_FILTER = 300000

  const staffSummary = Array.from(staffMerged.entries()).map(([, { displayName, monthData }]) => {
    const latestSales = monthData.get(staffLatestMonth) ?? 0
    const prevSales = monthData.get(staffPrevMonth) ?? 0
    const prev2Sales = monthData.get(staffPrev2Month) ?? 0
    const growthRate = prevSales > 0 ? ((latestSales - prevSales) / prevSales) * 100 : null

    const monthly = Array.from(monthData.entries())
      .map(([month, sales]) => ({ month, sales }))
      .sort((a, b) => a.month.localeCompare(b.month))

    return {
      staff: displayName,
      latestSales,
      prevSales,
      prev2Sales,
      growthRate,
      monthly,
    }
  })
  .filter(s => s.latestSales > MIN_SALES_FILTER)
  .sort((a, b) => b.latestSales - a.latestSales)

  // ━━━ 年間合計 & 着地予測 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 月次データを年ごとにグループ化
  const byYear = new Map<number, Map<number, { sales: number; customers: number }>>()
  for (const m of totalMonthly) {
    const [yStr, mStr] = m.month.split('-')
    const y = parseInt(yStr)
    const mo = parseInt(mStr)
    if (!byYear.has(y)) byYear.set(y, new Map())
    byYear.get(y)!.set(mo, { sales: m.sales, customers: m.customers })
  }

  // 年間サマリーを生成
  const annualSummaries: AnnualSummary[] = []
  for (const [year, monthMap] of Array.from(byYear.entries()).sort((a, b) => a[0] - b[0])) {
    const details: AnnualMonthDetail[] = []
    let total = 0
    let customers = 0
    let actualMonths = 0

    for (let mo = 1; mo <= 12; mo++) {
      const data = monthMap.get(mo)
      if (data) {
        details.push({ month: mo, sales: data.sales, customers: data.customers, isProjected: false })
        total += data.sales
        customers += data.customers
        actualMonths++
      }
    }

    annualSummaries.push({
      year,
      total,
      customers,
      monthDetails: details,
      isComplete: actualMonths === 12,
      actualMonths,
    })
  }

  // 着地予測: 今年のデータが不完全な場合、前年の月別パターンと成長率で予測
  let projection: Projection | null = null
  const currentYear = toYear
  const currentYearData = byYear.get(currentYear)
  const prevYear = currentYear - 1
  const prevYearData = byYear.get(prevYear)

  if (currentYearData && prevYearData) {
    const actualMonthNumbers = Array.from(currentYearData.keys())
    const isComplete = actualMonthNumbers.length === 12

    if (!isComplete) {
      // 前年同月比の成長率を計算（両年にデータがある月のみ）
      const yoyRates: number[] = []
      const yoyCustomerRates: number[] = []
      for (const mo of actualMonthNumbers) {
        const prev = prevYearData.get(mo)
        const curr = currentYearData.get(mo)
        if (prev && curr && prev.sales > 0) {
          yoyRates.push((curr.sales - prev.sales) / prev.sales)
        }
        if (prev && curr && prev.customers > 0) {
          yoyCustomerRates.push((curr.customers - prev.customers) / prev.customers)
        }
      }

      const avgGrowthRate = yoyRates.length > 0
        ? yoyRates.reduce((a, b) => a + b, 0) / yoyRates.length
        : null
      const avgCustomerGrowthRate = yoyCustomerRates.length > 0
        ? yoyCustomerRates.reduce((a, b) => a + b, 0) / yoyCustomerRates.length
        : null

      // 12ヶ月の詳細（実績 + 予測）
      const monthDetails: AnnualMonthDetail[] = []
      let projectedTotal = 0
      let projectedCustomers = 0
      let ytdTotal = 0
      let ytdCustomers = 0

      for (let mo = 1; mo <= 12; mo++) {
        const actual = currentYearData.get(mo)
        if (actual) {
          // 実績あり
          monthDetails.push({
            month: mo,
            sales: actual.sales,
            customers: actual.customers,
            isProjected: false,
          })
          projectedTotal += actual.sales
          projectedCustomers += actual.customers
          ytdTotal += actual.sales
          ytdCustomers += actual.customers
        } else {
          // 予測: 前年同月 × (1 + 平均成長率)
          const prevMonthData = prevYearData.get(mo)
          if (prevMonthData && avgGrowthRate !== null) {
            const projSales = Math.round(prevMonthData.sales * (1 + avgGrowthRate))
            const projCust = avgCustomerGrowthRate !== null
              ? Math.round(prevMonthData.customers * (1 + avgCustomerGrowthRate))
              : 0
            monthDetails.push({
              month: mo,
              sales: projSales,
              customers: projCust,
              isProjected: true,
            })
            projectedTotal += projSales
            projectedCustomers += projCust
          }
        }
      }

      const prevYearTotal = Array.from(prevYearData.values()).reduce((s, v) => s + v.sales, 0)

      projection = {
        currentYear,
        projectedTotal,
        projectedCustomers,
        ytdTotal,
        ytdCustomers,
        ytdMonths: actualMonthNumbers.length,
        avgYoYGrowthRate: avgGrowthRate !== null ? avgGrowthRate * 100 : null,
        monthDetails,
        prevYearTotal,
        yoyProjectedGrowth: prevYearTotal > 0
          ? ((projectedTotal - prevYearTotal) / prevYearTotal) * 100
          : null,
      }
    }
  }

  return NextResponse.json({
    months,
    latestMonth,
    prevMonth,
    staffLatestMonth,
    staffPrevMonth,
    staffPrev2Month,
    totalMonthly,
    storeByMonth,
    staffSummary,
    annualSummaries,
    projection,
  })
}
